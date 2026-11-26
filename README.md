# Braille PCV

App da Hinojosa (setor PCV) que compara a foto do verso de uma caixa com o PDF de braille aprovado pelo cliente, ponto a ponto. Tem logins com três perfis e uma relação MM ↔ código de braille extraída do SAP, com lembrete por email quando fica desatualizada.

A app usa **dois repositórios**:

| Repositório | Visibilidade | Conteúdo |
|---|---|---|
| `braille-pcv` (este) | **Público**, publicado no GitHub Pages | Só o código da app e `users.json` (palavras-passe nunca guardadas; tokens cifrados) |
| `braille-pcv-dados` | **Privado** | Relação SAP, lista de PDFs, definições, histórico, exemplo e o lembrete por email |

Os PDFs de braille e as fotos **nunca saem do dispositivo**: a comparação corre no navegador.

---

## Instalação (uma vez, ~30 minutos)

Sem git: tudo se faz na página do GitHub.

### 1. Conta e repositórios
1. Entre no GitHub (de preferência numa organização da empresa, para não depender de uma conta pessoal).
2. Crie o repositório **`braille-pcv`** como **Public**. Carregue o conteúdo desta pasta com *Add file › Upload files* (arraste todas as pastas e ficheiros).
3. Crie o repositório **`braille-pcv-dados`** como **Private**. Carregue o conteúdo da pasta `braille-pcv-dados`.
   - A pasta `.github` pode não ser incluída ao arrastar (é uma pasta oculta). Se não aparecer, use *Add file › Create new file*, escreva o caminho `.github/workflows/lembrete.yml` e cole o conteúdo do ficheiro.

### 2. Ligar os dois repositórios
No repositório `braille-pcv`, edite `config.json` e troque `OWNER` pelo nome da conta ou organização:
```json
{ "appRepo": "minha-org/braille-pcv", "dataRepo": "minha-org/braille-pcv-dados", "branch": "main" }
```
Enquanto `OWNER` não for trocado, a app abre em **modo demonstração** (dados só no navegador, utilizadores de teste `operador`, `supervisor` e `manager`, com a palavra-passe igual ao nome).

### 3. Publicar a app (GitHub Pages)
`braille-pcv` › *Settings › Pages* › *Source: Deploy from a branch* › *Branch: main / (root)* › *Save*.
Ao fim de 1–2 minutos a app fica em `https://<conta>.github.io/braille-pcv/`.

### 4. Criar os três tokens de acesso
*Foto de perfil › Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token.*
Em cada um: *Resource owner* = a conta/organização; validade = a máxima permitida (anote a data para renovar).

| Token | Repositórios | Permissões |
|---|---|---|
| **Operador** | só `braille-pcv-dados` | *Contents: Read and write* (lê a relação e grava cada verificação no registo) |
| **Supervisor** | só `braille-pcv-dados` | *Contents: Read and write* |
| **Manager** | `braille-pcv` e `braille-pcv-dados` | *Contents: Read and write* · *Actions: Read and write* |

Os tokens não são guardados em claro em lado nenhum: cada utilizador recebe o token do seu perfil cifrado com a sua palavra-passe.

### 5. Email do lembrete (segredos SMTP)
`braille-pcv-dados` › *Settings › Secrets and variables › Actions › New repository secret*:

| Segredo | Exemplo | |
|---|---|---|
| `SMTP_HOST` | `smtp.office365.com` | obrigatório |
| `SMTP_PORT` | `587` | opcional (587 por omissão; 465 usa SSL) |
| `SMTP_USER` | `braille.pcv@empresa.com` | obrigatório |
| `SMTP_PASS` | palavra-passe ou *app password* | obrigatório |
| `SMTP_FROM` | `Braille PCV <braille.pcv@empresa.com>` | opcional |

Notas: no Office 365 a caixa de correio tem de ter *SMTP AUTH* ativo (pedido ao IT). Enquanto isso, pode usar uma conta Gmail com *palavra-passe de aplicação* (`smtp.gmail.com`, porta 587).

### 6. Primeiro acesso
Abra a app. Como ainda não há utilizadores, aparece a **Configuração inicial**: crie o primeiro Manager e cole os três tokens. A app valida-os e cria `users.json`, `settings.json` e `meta.json`.

### 7. Configurar e usar
1. **Definições** (Manager): prazo máximo (1–30 dias), emails dos destinatários e link da app. Use **Enviar email de teste** para confirmar o SMTP.
2. **Definições › Utilizadores**: crie os Operadores e Supervisores (palavra-passe com 10 ou mais caracteres). Um utilizador novo consegue entrar 1–2 minutos depois (tempo de publicação do Pages).
3. **Atualização** (Supervisor): carregue o Excel da IH09 seguindo o procedimento `docs/procedimento-atualizacao.pdf` (PLM009.CV). Os PDFs são lidos diretamente da pasta `11 - PCV\00 - BRAILLES` com o botão “Ligar pasta”; basta colocar lá os PDFs novos.

---

## Perfis

| Perfil | Abas |
|---|---|
| Operador | Início, Verificar, Biblioteca, Como funciona |
| Supervisor | + Atualização, + Registo (histórico de todas as verificações, relatório diário, exportação para Excel) |
| Manager | + Definições (prazo, destinatários do email, dias de fecho, utilizadores, cofre de tokens) |
| FAMAG | Só Verificar (machos) e Como funciona. Usa o token Operador. |

Os avisos de prazo (relação SAP desatualizada), de registo cheio e de incidências por tratar só aparecem a Supervisores e Managers.

## Verificar: caixa ou macho
- **Caixa**: MM → braille da relação SAP. O botão **Ler OF** lê a ordem de fabrico por foto. Usa o código da linha *Braille* de cada MM e ignora Cortante e Reserva de verniz. Avisa se o braille da OF for diferente do SAP. O leitor de texto (Tesseract.js) só é descarregado da primeira vez.
- **Macho**: código do braille (1300…) e foto da face com os pinos. Pode ser aberto pela checklist de receção da PCV Ferramentas, e o resultado volta sozinho (ver [INTEGRACAO.md](INTEGRACAO.md)).
- **Abrir câmara**: a moldura tem a forma do braille do PDF. A zona da moldura passa a ser a zona marcada, e a câmara avisa se a foto está escura ou tremida e mostra o nível do telemóvel.
- PDFs com vários blocos de braille (faces diferentes da caixa) são separados por blocos. A foto é comparada com o bloco que melhor alinhar.

## PDFs: pasta lembrada e padrões sincronizados
- Nos computadores, **Ligar pasta** escolhe a pasta `00 - BRAILLES`. No Chrome e no Edge a pasta fica lembrada no computador. Nas sessões seguintes o navegador pede só uma confirmação.
- Quando um Supervisor ou Manager liga a pasta, a app extrai a posição dos pontos dos PDFs novos ou alterados. Guarda-a em `padroes/padroes.json` no repositório privado, sem guardar os PDFs.
- Os tablets, os telemóveis e a FAMAG só precisam do MM ou do código: usam esses padrões.

## Fotos, relatório diário e "A app enganou-se"
- **Fotos** (em `fotos/AAAA-MM-DD/` no repositório privado, reduzidas):
  - NOK: ficam sempre guardadas.
  - A CONFIRMAR e INCONCLUSIVO: ficam guardadas, mas são apagadas se o mesmo MM (ou macho) der OK no mesmo dia.
- **Relatório diário** (`relatorios/relatorios.json`): é criado quando um Supervisor ou Manager abre a app.
  - Cobre das 6h do dia útil anterior às 6h do dia. À segunda-feira cobre desde sexta às 6h.
  - Não há relatório ao fim de semana, nos feriados nacionais (incluindo os de data móvel), no São João, na segunda-feira de Páscoa, a 24/12, a 31/12 e nos dias de fecho indicados em Definições.
  - Cada incidência tem o botão **Tratado**, com uma nota.
- **A app enganou-se?**: botão no resultado. O reporte e a foto ficam no registo e no relatório, para afinar a deteção.

## Registo de verificações
Cada comparação feita na app fica num registo partilhado (`registos/registo.json` no repositório de dados) com MM, código de braille, nome do ficheiro, data, utilizador, resultado e notas (o que não bateu certo). Se não houver rede, a verificação fica guardada no dispositivo e é enviada depois.

No separador **Registo**, Supervisores e Managers consultam e filtram o registo e exportam-no para Excel com o nome `RLM04-CV.Registo verificação de Braille pela APP - 26W47 V01.xlsx`. Quando o registo chega a 1500 verificações, a app pede para o fechar: o Excel é descarregado e guardado em `registos/arquivo/`, e começa o V02.

## Lembrete por email
O workflow `.github/workflows/lembrete.yml` (no repositório de dados) corre todos os dias às 06:00 UTC. Se a última atualização tiver mais dias do que o prazo, envia o email predefinido e repete-o diariamente até o ficheiro ser carregado. O texto do email está em `scripts/lembrete.py` (e a pré-visualização em `js/data.js`).

## Segurança e limites desta versão
- O código é público; os dados estão no repositório privado e só são lidos com um token válido.
- `users.json` é público mas só tem nomes, perfis e tokens **cifrados** (AES-GCM, chave derivada da palavra-passe com PBKDF2). Use palavras-passe fortes.
- Os tokens Operador e Supervisor têm escrita no repositório de dados: o Operador precisa dela para gravar o registo e as fotos. As restrições às abas Atualização, Registo e Definições são feitas na app. Só o token Manager consegue alterar utilizadores.
- **Cofre de tokens**: `users.json` guarda os tokens de cada perfil cifrados com uma chave desse perfil. Cada utilizador guarda só a chave do seu perfil, cifrada com a sua palavra-passe. O cofre é criado sozinho na primeira entrada de um Manager depois desta versão. Os utilizadores criados antes continuam a entrar sem mudar nada.
- **Quando um token expirar**: crie um novo com as mesmas permissões e cole-o em *Definições › Cofre de tokens*. Ninguém precisa de mudar a palavra-passe.
- O perfil FAMAG usa o token Operador. A app só lhe mostra a verificação de machos, mas tecnicamente esse token lê o repositório de dados (relação SAP e registo). Quando a app passar para os servidores da empresa, isto fica resolvido com permissões no servidor.
- Esta versão é para testes até haver decisão do IT; como é uma app estática, pode passar depois para os servidores da empresa sem alterações.

## Estrutura
```
index.html                     interface
css/app.css                    estilo (linguagem visual das apps PCV)
js/vision.js                   leitura do PDF (pdf.js), blocos, comparação com a foto
js/data.js                     GitHub / modo demonstração, cofre de tokens, importação SAP, calendário e relatório
js/camera.js                   câmara com moldura-guia, nível e avisos de luz e nitidez
js/ocr.js                      leitura da ordem de fabrico (Tesseract.js, carregado só quando é usado)
js/app.js                      abas, perfis e ecrãs
config.json                    repositórios a usar
INTEGRACAO.md                  como ligar ao FLOW e à checklist da PCV Ferramentas
docs/procedimento-atualizacao.pdf   procedimento PLM009.CV (fonte: .html)
assets/                        logótipos
```
