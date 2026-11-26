# Integração com o FLOW e a PCV Ferramentas

A Braille PCV está noutra conta GitHub (`hj-djmm.github.io`), mas integra-se nas duas apps sem problemas: o GitHub Pages permite abrir a app dentro de outra página, e as duas apps falam por `postMessage` (mensagens entre janelas do navegador, só entre origens autorizadas).

Substitua `hj-djmm` pela conta onde a Braille PCV estiver publicada.

---

## 1. Braille PCV dentro do FLOW

No repositório do FLOW, em `js/core.js`:

```js
// 1) acrescentar a app à lista APPS
var APPS={pcv:{...}, auditorias:{...}, contador:{...},
  braille:{url:'https://hj-djmm.github.io/braille-pcv/',d:'Verificação do braille por foto: caixas e machos.'}};

// 2) nome no menu (objeto TOOLS)
braille:'Braille PCV',

// 3) setor onde aparece (ex.: Corte e Vinco e/ou Qualidade)
{id:'corte-vinco', ..., tools:['producao-cv','intervencoes-cv','pcv','braille']},
```

O `iframe` do FLOW já tem `allow="camera"`, por isso a câmara funciona lá dentro.

Diferenças quando a Braille PCV abre dentro do FLOW:

- O utilizador entra com o login da Braille PCV. Pode marcar *Manter a sessão neste dispositivo*.
- Dentro do FLOW o navegador não deixa a app lembrar a pasta `00 - BRAILLES`. Os tablets não precisam dela, porque usam os padrões sincronizados. Nos computadores, os Supervisores usam o botão **Ecrã inteiro ↗** do FLOW.

---

## 2. Verificação do macho na checklist de receção (PCV Ferramentas)

Nas linhas da receção cuja descrição começa por **BrM** (machos de braille), acrescente um botão **Verificar braille**. O botão abre a Braille PCV já com o código do braille. Quando a verificação termina, a Braille PCV devolve o resultado à checklist.

```js
/* Braille PCV — verificação do macho de braille na receção */
const BRAILLE_PCV = "https://hj-djmm.github.io/braille-pcv/";
const BRAILLE_PCV_ORIGEM = "https://hj-djmm.github.io";

function verificarBraille(linha, onResultado) {
  // linha.mat = código do braille (1300…), linha.cod = ferramenta / cortante
  const ref = "rc-" + Date.now();
  const url = BRAILLE_PCV + "?macho=" + encodeURIComponent(linha.mat) +
              "&ferramenta=" + encodeURIComponent(linha.cod || "") + "&ref=" + ref;
  window.open(url, "braillepcv");
  function onMsg(e) {
    if (e.origin !== BRAILLE_PCV_ORIGEM) return;          // só aceita mensagens da Braille PCV
    const d = e.data;
    if (!d || d.type !== "braille-pcv:resultado" || d.ref !== ref) return;
    window.removeEventListener("message", onMsg);
    onResultado(d);
  }
  window.addEventListener("message", onMsg);
}

// exemplo de uso na checklist de receção:
// if (/^BrM/i.test(linha.desc)) botao.onclick = () => verificarBraille(linha, d => {
//   if (d.ok) marcarPonto("Braille verificado na app", "OK", d.utilizador + " · " + d.data);
//   else marcarPonto("Braille verificado na app", "NOK", d.resultado + ": " + d.notas);
// });
```

Mensagem enviada pela Braille PCV:

| Campo | Exemplo |
|---|---|
| `type` | `"braille-pcv:resultado"` |
| `ref` | o mesmo `ref` do pedido |
| `codigo` | `"130009554"` |
| `ferramenta` | `"S1958A"` |
| `resultado` | `"OK"`, `"NOK"`, `"A CONFIRMAR"` ou `"INCONCLUSIVO"` |
| `ok` | `true` só quando o resultado é OK |
| `momento` | `"FAMAG"` (fornecedor, antes de enviar) ou `"PCV receção"` |
| `utilizador`, `data`, `notas` | quem verificou, quando (ISO) e o que não bateu certo |

A Braille PCV só envia a mensagem para as origens autorizadas em `settings.json` (`allowedOrigins`, por omissão `https://jscampos87.github.io`).

### Dois momentos: FAMAG e PCV
- **FAMAG** (perfil *FAMAG* na Braille PCV): verifica o macho antes de o enviar. Só vê a verificação de machos.
- **PCV**, na receção: ao abrir a verificação, a app mostra se a FAMAG já verificou esse código e com que resultado.
- As duas verificações ficam no registo da Braille PCV (coluna *Tipo*: `Macho · FAMAG (expedição)` / `Macho · PCV (receção)`).
