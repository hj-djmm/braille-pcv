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
| **Operador** | só `braille-pcv-dados` | *Contents: Read-only* |
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
3. **Atualização** (Supervisor): carregue o Excel do SAP seguindo o procedimento `docs/procedimento-atualizacao.pdf`, e a lista de PDFs a partir da pasta `00 - BRAILLES`.

---

## Perfis

| Perfil | Abas |
|---|---|
| Operador | Início, Verificar, Biblioteca, Como funciona |
| Supervisor | + Atualização |
| Manager | + Definições (prazo, destinatários do email, utilizadores) |

## Lembrete por email
O workflow `.github/workflows/lembrete.yml` (no repositório de dados) corre todos os dias às 06:00 UTC. Se a última atualização tiver mais dias do que o prazo, envia o email predefinido e repete-o diariamente até o ficheiro ser carregado. O texto do email está em `scripts/lembrete.py` (e a pré-visualização em `js/data.js`).

## Segurança e limites desta versão
- O código é público; os dados estão no repositório privado e só são lidos com um token válido.
- `users.json` é público mas só tem nomes, perfis e tokens **cifrados** (AES-GCM, chave derivada da palavra-passe com PBKDF2). Use palavras-passe fortes.
- O Operador só tem token de leitura. O Supervisor tem escrita no repositório de dados; a restrição às Definições é feita na app. Só o token Manager consegue alterar utilizadores.
- Quando um token expirar: crie um novo com as mesmas permissões e volte a criar os utilizadores desse perfil em Definições (ou recomece a Configuração inicial apagando `users.json`).
- O histórico de verificações fica em cada dispositivo.
- Esta versão é para testes até haver decisão do IT; como é uma app estática, pode passar depois para os servidores da empresa sem alterações.

## Estrutura
```
index.html                     interface
css/app.css                    estilo (linguagem visual das apps PCV)
js/vision.js                   leitura do PDF (pdf.js) e comparação com a foto
js/data.js                     GitHub / modo demonstração, utilizadores, importação SAP
js/app.js                      abas, perfis e ecrãs
config.json                    repositórios a usar
docs/procedimento-atualizacao.pdf   procedimento PR-PCV-BRL-01 (fonte: .html)
assets/                        logótipos
```
