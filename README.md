# Meditações diárias no WhatsApp

Sistema para enviar uma meditação por dia a grupos do WhatsApp usando
[`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys), com interface
pública de preparação, configuração em repositório privado, envio idempotente e
orquestração pelo GitHub Actions.

> **Aviso:** Baileys é uma integração não oficial do WhatsApp Web. O WhatsApp pode
> alterar o protocolo, limitar ou restringir a conta, e não há garantia de
> disponibilidade. Use apenas em grupos com consentimento e para conteúdo legítimo.
>
> **Estado atual:** nenhum commit, push, publicação ou envio real foi executado.
> Uma sessão válida foi conectada localmente, mas ainda não foi usada para envio. O arquivo real de links não foi
> copiado para este projeto. Leia a seção [Antes do primeiro envio real](#antes-do-primeiro-envio-real)
> e autorize explicitamente cada etapa sensível.

## O que o sistema faz

- Importa a programação no formato `YYYY-MM-DD  URL  (Dia · DD/MM · Título)`.
- Valida datas, URLs e títulos, aponta erros com o número da linha e bloqueia
  datas duplicadas.
- Permite adicionar e editar registros manualmente e exportar uma cópia legível.
- Mostra datas faltantes no intervalo esperado, sem preencher nada automaticamente.
- Monta a mensagem como:

  ```text
  Segunda-feira, 30/11/2026
  Título da meditação
  https://exemplo.com/meditacao.html
  ```

  O dia da semana é sempre recalculado a partir da data; o texto importado não é
  usado como fonte de verdade.
- Envia no máximo uma vez por data e por grupo configurado.
- Mantém o estado de entrega fora do disco temporário do runner, em um repositório
  privado, para preservar a idempotência entre execuções.
- Faz novas tentativas somente quando o operador pede explicitamente e somente para
  grupos com falha ou resultado incerto.
- Tem modo dry-run local e no GitHub Actions, sem conectar ao WhatsApp.
- Publica apenas a interface estática em `docs/`; nenhum dado privado entra no site.

## Pré-requisitos

- Node.js 20 ou superior (o `.nvmrc` usa 22).
- Uma conta do GitHub com permissão para criar o repositório privado, configurar
  Actions/Pages e gerar um fine-grained PAT.
- Uma conta do WhatsApp que possa entrar nos grupos de destino, com sessão
  autorizada para uso no Baileys.
- A programação privada no formato descrito neste README.

## Arquitetura

```text
Repositório público                          Repositório privado
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ src/  (código e testes)     │              │ data/config.json             │
│ docs/ (interface estática)  │              │ data/schedule.json           │
│ .github/workflows/          │   PAT        │ data/state.json              │
│                             │ ───────────> │ data/session.enc.b64         │
└──────────────┬──────────────┘              └──────────────────────────────┘
               │
               │ GitHub Actions (agendado ou manual)
               ▼
      Baileys ── WhatsApp Web ── grupos configurados
```

- **Código e interface:** podem ser públicos. Não contêm IDs, links, títulos,
  sessão, estado nem tokens.
- **Configuração, programação, estado e sessão cifrada:** ficam apenas no
  repositório privado, acessado pela API de Contents do GitHub com um token
  fine-grained.
- **GitHub Actions:** executa testes, valida o build público e roda o envio. O
  agendamento é horário em UTC; o código verifica a hora local e a janela de envio.
- **Sessão:** é criada somente em uma máquina local, cifrada com AES-256-GCM e
  restaurada apenas em `$RUNNER_TEMP`. O runner nunca cria uma sessão nova nem
  exibe QR Code.

## Segurança e privacidade

Nunca faça commit, upload, anexo, screenshot ou log de:

- conteúdo de `.baileys-auth/`, `creds.json` ou de qualquer arquivo de sessão;
- `session.b64`, `session.enc.b64`, `SESSION_ENCRYPTION_KEY` ou
  `BAILEYS_SESSION_B64`;
- `PRIVATE_CONFIG_TOKEN`, PATs, tokens de ações ou senhas;
- `config.json`, `schedule.json`, `state.json` reais;
- IDs completos de grupos (`...@g.us`), links, títulos ou histórico de envios;
- o arquivo `links-meditacoes.txt` original.

O `.gitignore` cobre os nomes mais comuns, mas ele não é uma garantia. Antes de
qualquer commit, confira `git status` e o conteúdo que será enviado.

### Token do GitHub

Use um **fine-grained PAT** com:

- acesso somente ao repositório privado de configuração;
- permissão **Contents: Read and write** nesse repositório;
- validade curta e rotação periódica;
- nenhuma permissão em outros repositórios.

O token é passado ao workflow como `PRIVATE_CONFIG_TOKEN`. O runner o usa para ler
`config.json`, `schedule.json` e `session.enc.b64`, e para gravar `state.json` e a
sessão atualizada. O token nunca deve ser colocado no código, na interface ou no
repositório privado.

### Chave da sessão

A sessão Baileys é compactada e cifrada com AES-256-GCM usando uma chave de 32
bytes em base64 (`SESSION_ENCRYPTION_KEY`). A chave fica somente no GitHub Secrets
(e em um cofre local, se você precisar recifrar a sessão). O arquivo cifrado no
repositório privado ainda é sensível: quem tiver a chave e o arquivo consegue
restaurar a sessão. Proteja ambos.

### Interface pública e Pages

A interface em `docs/` é estática e pública. Ela:

- não lê nem grava o repositório privado;
- não envia dados pela rede;
- não usa `localStorage`, `sessionStorage` ou cookies como armazenamento;
- mantém os dados apenas na memória da aba e nos arquivos que você exporta;
- exibe um aviso sobre a impossibilidade de editar a configuração privada com
  segurança sem um backend autenticado.

O Pages não é um cofre. Qualquer arquivo exportado pela interface (configuração,
programação ou TXT legível) contém dados privados e deve ser enviado somente ao
repositório privado, nunca ao repositório público, a issues, a artifacts ou a
serviços de terceiros.

### Logs e artefatos

- O resumo do Actions mostra apenas “Grupo 1/2/...”, status e contagens; não mostra
  IDs, links, títulos ou o texto da mensagem.
- Em `GITHUB_ACTIONS=true`, a prévia da mensagem é omitida dos logs.
- O workflow de envio não publica artifacts.
- Erros são sanitizados para remover JIDs, números, tokens e campos sensíveis.
- Não ative `DEBUG=true` em produção: stack traces podem conter detalhes internos.

## Estrutura do projeto

```text
.github/workflows/
  ci.yml                 testes e build em push/PR
  daily-send.yml         agendamento horário + workflow_dispatch
  deploy-pages.yml       publicação do site estático
docs/                    interface pública (HTML/CSS/JS, sem dados privados)
scripts/build-pages.mjs  monta _site apenas com docs/ + src/shared/
src/shared/              datas, configuração, programação e mensagem
src/lib/                 estado, repositório privado, sessão e gateway Baileys
src/run-daily.js         execução diária e CLI
src/import-schedule.js   importação e validação do TXT
src/validate.js          validação de configuração/programação/estado
src/session-*.js         login local, empacotamento, cifra e limpeza
test/                     testes automatizados e fixtures sem dados reais
```

## Formato da programação

Cada linha não vazia deve seguir:

```text
YYYY-MM-DD  URL  (Dia · DD/MM · Título)
```

Exemplo fictício:

```text
2026-12-07  https://exemplo.com/meditacao.html  (Segunda · 07/12 · Título da meditação)
```

Regras aplicadas na importação:

- a data precisa existir no calendário e usar `YYYY-MM-DD`;
- a URL deve ser `http` ou `https`, sem usuário/senha e sem espaços;
- o título não pode ficar vazio, ter mais de 300 caracteres ou conter caracteres
  de controle;
- o trecho entre parênteses precisa ter dia/mês e título;
- o dia da semana informado é comparado com a data e gera aviso se divergir, mas é
  recalculado na mensagem;
- datas duplicadas bloqueiam a importação e mostram as duas linhas;
- linhas inválidas geram erros numerados; nenhuma linha é descartada em silêncio.

O intervalo esperado (`schedulePeriod`) serve apenas para relatar datas faltantes.
Ele não cria registros, não reutiliza links de outros dias e não autoriza envio.

## Configuração privada

O repositório privado deve ter esta estrutura:

```text
data/
  config.json
  schedule.json
  state.json          (criado/atualizado pelo runner)
  session.enc.b64     (sessão cifrada; criada localmente)
```

### `data/config.json`

Exemplo com placeholders. Substitua os IDs pelos JIDs completos dos grupos reais;
não use links de convite.

```json
{
  "version": 1,
  "timezone": "America/Sao_Paulo",
  "sendTime": "06:00",
  "maxDelayMinutes": 180,
  "groups": [
    { "label": "Grupo principal", "id": "ID_DO_GRUPO_1@g.us" },
    { "label": "Grupo secundário", "id": "ID_DO_GRUPO_2@g.us" }
  ],
  "schedulePeriod": {
    "start": "2026-01-01",
    "end": "2026-12-31"
  },
  "requireAck": false,
  "ackTimeoutSeconds": 30,
  "sendDelayMs": 2000
}
```

- `timezone`: padrão `America/Sao_Paulo`; use um nome IANA válido.
- `sendTime`: padrão `06:00`, no fuso acima.
- `maxDelayMinutes`: janela máxima depois do horário. Se o runner atrasar mais, o
  envio é registrado como janela perdida e não ocorre.
- `groups`: pelo menos dois grupos, no máximo 50, sem IDs duplicados.
- `schedulePeriod`: opcional; usado para conferir datas faltantes.
- `requireAck`: se `true`, aguarda confirmação do servidor antes de considerar
  enviado; se `false`, a confirmação é o retorno da biblioteca com ID da mensagem.
- `ackTimeoutSeconds`: entre 5 e 120.
- `sendDelayMs`: pausa entre grupos, entre 0 e 60000 ms.

### `data/schedule.json`

O formato exportado pela interface/CLI é:

```json
{
  "version": 1,
  "records": [
    {
      "date": "2026-01-01",
      "title": "Título da meditação",
      "url": "https://exemplo.com/meditacao.html"
    }
  ]
}
```

### `data/state.json`

É gerado pelo runner. Não edite manualmente e não apague sem backup: ele é a
memória de idempotência. O estado registra, por data e por impressão digital do
grupo, o status (`sending`, `sent`, `failed`, `unknown`), tentativas, timestamps e
um código de erro seguro. As impressões digitais são hashes; ainda assim, o
arquivo contém nomes de grupos e histórico e por isso permanece privado.

### `data/session.enc.b64`

Contém a sessão Baileys compactada e cifrada, em base64. É restaurada apenas em
`$RUNNER_TEMP/meditacoes-baileys-auth` e removida ao final. Se o runner precisar
de QR Code, ele falha com `SESSION_REQUIRES_QR` em vez de criar uma sessão nova.

## Preparação

### 1. Criar o repositório privado

Crie um repositório GitHub **privado** (por exemplo `meditacoes-config`) com a
pasta `data/`. Adicione `data/config.json` e `data/schedule.json`. Não torne esse
repositório público e não adicione a ele a interface ou o código público.

### 2. Obter os JIDs dos grupos

Use o identificador completo do grupo, terminado em `@g.us`. Não use links de
convite, números de telefone ou IDs parciais. Obtenha os JIDs por um método local
confiável e mantenha-os apenas no repositório privado. A interface pública só
mostra um placeholder e nunca deve receber IDs reais se ela for publicada.

### 3. Criar a sessão Baileys (somente com autorização)

Esta etapa abre uma conexão real com o WhatsApp e deve ser feita somente depois de
autorizada. Para criar uma sessão nova:

```powershell
npm run login -- --new-session --dir .baileys-auth
```

Para retomar uma tentativa interrompida, sem apagar a pasta existente:

```powershell
npm run login -- --resume --dir .baileys-auth
```

- O QR Code aparece apenas no terminal local; não grave a tela.
- O comando não envia mensagens.
- O terminal mostra o código do fechamento (`401`, `403`, `428`, `503`, `515` etc.).
  O código `515 restartRequired` é tratado com reconexão automática.
- Se o QR foi escaneado mas o celular não confirmou o dispositivo, preserve a pasta
  e tente `--resume`; se continuar falhando, renomeie a pasta para backup e crie
  uma sessão nova.
- Se já existir uma sessão válida, preserve-a; não use `--new-session` para substituí-la.
- Nunca execute esse comando no GitHub Actions ou em uma máquina compartilhada.

Se você já tem uma sessão Baileys existente, não a recrie. Apenas empacote/cifre a
pasta que já contém `creds.json`, depois de conferir que é a sessão correta.

### 4. Gerar a chave de cifra

Gere 32 bytes aleatórios em base64 e guarde o valor em um cofre de senhas e no
GitHub Secrets. Não coloque a chave no repositório privado.

```powershell
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64'));"
```

### 5. Cifrar a sessão

Defina `SESSION_ENCRYPTION_KEY` no terminal local por um método que não deixe a
chave no histórico. No PowerShell, uma opção é ler sem eco e converter apenas em
memória:

```powershell
$secure = Read-Host 'SESSION_ENCRYPTION_KEY' -AsSecureString
$env:SESSION_ENCRYPTION_KEY = [System.Net.NetworkCredential]::new('', $secure).Password
npm run session:seal -- --dir .baileys-auth --out session.enc.b64
Remove-Item Env:SESSION_ENCRYPTION_KEY
```

Envie `session.enc.b64` ao repositório privado como `data/session.enc.b64` usando
um canal autenticado. Depois, apague a cópia local `session.enc.b64` (o
`.gitignore` já a bloqueia, mas ainda assim não a deixe solta). Preserve
`.baileys-auth/` conforme sua política de backup; ela nunca deve ser versionada.

Opcionalmente, para bootstrap por Secret em vez do arquivo no repositório privado:

```powershell
npm run session:pack -- --dir .baileys-auth --out session.b64
```

Isso gera um base64 do pacote compactado, **sem cifra**, para
`BAILEYS_SESSION_B64`. O caminho recomendado é o arquivo cifrado no repositório
privado; o Secret é apenas uma alternativa e tem limites de tamanho. Apague
`session.b64` depois e nunca o envie a lugar nenhum.

### 6. Configurar variáveis e secrets no GitHub

No repositório público, em **Settings → Secrets and variables → Actions**:

Variáveis (não secretas):

| Nome | Exemplo | Uso |
| --- | --- | --- |
| `PRIVATE_CONFIG_REPO` | `seu-usuario/meditacoes-config` | repositório privado |
| `PRIVATE_CONFIG_BRANCH` | `main` | branch do repositório privado (opcional) |

Secrets:

| Nome | Conteúdo |
| --- | --- |
| `PRIVATE_CONFIG_TOKEN` | fine-grained PAT com Contents read/write no repositório privado |
| `SESSION_ENCRYPTION_KEY` | chave base64 de 32 bytes usada no `session:seal` |
| `BAILEYS_SESSION_B64` | opcional; bootstrap sem cifra, não recomendado |

Não crie um secret `ALLOW_LIVE_SEND`: o workflow o define somente para execução
agendada ou para disparo manual com `confirm_live=true`.

### 7. Importar e validar a programação

Com o arquivo TXT privado fora do repositório público:

```powershell
npm run import -- --file C:\caminho\privado\links-meditacoes.txt `
  --out schedule.private.json `
  --txt programacao-legivel.txt `
  --from 2026-01-01 --to 2026-12-31
```

Use `--require-complete` se quiser bloquear a importação quando houver qualquer
data faltante no intervalo. Sem essa opção, as datas faltantes são apenas
relatadas. O comando não grava arquivos se houver erros ou duplicidades.

Valide os arquivos antes de enviá-los:

```powershell
npm run validate -- --config config.private.json --schedule schedule.private.json `
  --from 2026-01-01 --to 2026-12-31
```

Envie `schedule.private.json` ao repositório privado como `data/schedule.json`.
A cópia legível (`programacao-legivel.txt`) também é privada.

### 8. Configurar grupos pela interface (opcional)

Você pode montar a configuração na interface pública, validar e exportar
`config.private.json`, depois renomeá-lo para `data/config.json` no repositório
privado. A interface não envia nada sozinha e não consegue gravar no GitHub.

Alternativa local: crie `config.private.json` manualmente seguindo o exemplo acima
e valide com `npm run validate`.

### 9. Fazer o primeiro dry-run

No GitHub: **Actions → Envio diário de meditações → Run workflow**, mantenha
`dry_run=true`, `confirm_live=false` e execute. O workflow:

1. instala dependências e roda os testes;
2. valida o build público;
3. lê a configuração e a programação do repositório privado;
4. mostra apenas contagens e estados seguros;
5. **não carrega a sessão, não conecta ao WhatsApp e não grava estado**.

Para ver a mensagem completa sem publicá-la em logs, rode localmente:

```powershell
npm run dry-run -- --config-file config.private.json `
  --schedule-file schedule.private.json `
  --date 2026-01-01 --show-message
```

O dry-run local sem `--state-file` usa estado em memória e não grava nada. Com
`--state-file`, o arquivo é tratado como somente leitura.

## Execução no GitHub Actions

### Agendamento

O workflow `daily-send.yml` roda a cada hora em UTC:

```yaml
schedule:
  - cron: '0 * * * *'
```

Ele não envia a cada hora. Em cada execução, `run-daily.js`:

1. calcula a data e a hora no fuso configurado;
2. se estiver antes de `sendTime`, retorna `before_window` sem gravar estado;
3. se estiver dentro de `sendTime + maxDelayMinutes`, tenta enviar os grupos
   pendentes;
4. se estiver atrasado além da janela, registra `missed_window` uma vez e não
   envia;
5. se já houve tentativa real naquela data, retorna `already_attempted`.

A data usada é sempre a data local no fuso configurado. O cron não precisa ser
alterado quando o horário local mudar; a checagem é feita em tempo de execução.

### Disparo manual

`workflow_dispatch` tem quatro entradas:

| Entrada | Padrão | Efeito |
| --- | --- | --- |
| `dry_run` | `true` | simula sem conectar nem enviar |
| `target_date` | vazio | vazio = hoje no fuso; aceita `YYYY-MM-DD` (no live, hoje ou passado com retry; futuro é recusado) |
| `retry_failed` | `false` | permite nova tentativa apenas para falha/incerteza |
| `confirm_live` | `false` | confirmação explícita para envio real |

Regras:

- `dry_run=true` nunca conecta ao WhatsApp.
- `dry_run=false` só funciona com `confirm_live=true`.
- o workflow também exige `ALLOW_LIVE_SEND=confirm-send`, que ele mesmo define
  apenas no agendamento ou quando `confirm_live=true`.
- envio real para data futura é recusado.
- envio real para data passada exige `retry_failed=true`.
- `retry_failed` nunca reenvia grupos já `sent`; ele só destrava `failed`,
  `unknown` ou `sending`.

### Por que não há retry automático?

Um envio pode ter sido aceito pelo WhatsApp mesmo quando a resposta se perde. Se o
runner repetisse tudo automaticamente, poderia duplicar mensagens. Por isso:

- antes de enviar, o estado é gravado como `sending`;
- `sent` só é registrado depois que a biblioteca retorna o ID da mensagem (e,
  opcionalmente, depois do ACK);
- `unknown` representa “pode ter enviado”, não sucesso;
- falhas e incertezas ficam aguardando uma decisão humana;
- a próxima execução agendada não repete a data, pois já existe tentativa real.

O sistema evita reenvios automáticos e só marca `sent` com confirmação da
biblioteca. Ainda assim, uma nova tentativa manual de um status `unknown` pode
duplicar uma mensagem que já havia sido entregue. Não existe garantia de
exatamente uma entrega em sistemas distribuídos; confira o estado antes de
destravar uma incerteza.

## Comandos locais

```powershell
npm ci
npm test
npm run pages:build
npm run validate -- --config config.private.json --schedule schedule.private.json
npm run dry-run -- --config-file config.private.json --schedule-file schedule.private.json --date 2026-01-01 --show-message
```

Envio real local (somente com autorização explícita; exige sessão existente e
`--state-file` para preservar a idempotência):

```powershell
$env:ALLOW_LIVE_SEND = 'confirm-send'
npm run send -- --confirm-live `
  --config-file config.private.json `
  --schedule-file schedule.private.json `
  --state-file state.private.json `
  --session-dir .baileys-auth
Remove-Item Env:ALLOW_LIVE_SEND
```

Não use envio local em paralelo com o workflow: os dois podem compartilhar a mesma
sessão e o mesmo estado, causando conflito ou comportamento indefinido.

## Interface pública e Pages

- O build público é feito por `npm run pages:build`. Ele copia somente `docs/` e
  `src/shared/` para `_site` e falha se encontrar `.env`, `data/`, sessões,
  configurações privadas, tokens, JIDs reais, `localStorage` ou chamadas de rede
  no JavaScript.
- O workflow `deploy-pages.yml` publica `_site` no GitHub Pages quando houver push
  em `main` (nos caminhos relevantes) ou disparo manual.
- Para ativar: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
- A interface não edita o repositório privado. O fluxo é exportar o arquivo,
  renomeá-lo para `data/config.json` ou `data/schedule.json` e enviá-lo manualmente
  ao repositório privado.
- A configuração exportada usa `requireAck: false` e `sendDelayMs: 2000`. Se você
  precisar de ACK do servidor ou de outra pausa, ajuste esses campos no JSON
  privado depois de exportar.
- Para testar localmente, sirva o build por HTTP (módulos ES não funcionam
  confiavelmente via `file://`):

  ```powershell
  npm run pages:build
  python -m http.server 8080 --directory _site
  ```

  Abra `http://localhost:8080`.

`localStorage` não é usado como segurança nem como armazenamento de configuração.
Sem um backend autenticado, uma página pública não tem como ler ou gravar o
repositório privado com segurança. A alternativa implementada é exportar e enviar
os arquivos manualmente.

## Limitações do GitHub Actions e do WhatsApp

- O cron do GitHub Actions usa UTC e não garante o minuto exato. Filas,
  manutenção e carga podem atrasar a execução.
- O intervalo mínimo de cron é de 5 minutos; este projeto usa uma execução por
  hora e uma janela de tolerância, não um disparo exato.
- Workflows agendados rodam apenas no branch padrão e podem ser desativados após
  60 dias sem atividade no repositório (especialmente em repositórios públicos).
  Reative em **Actions** se necessário.
- O horário local é calculado pela base IANA disponível no runner. Mudanças de
  fuso ou horário de verão são tratadas pela checagem local; um horário local que
  não exista no dia (saltos de DST) pode ser pulado, e um horário repetido pode
  ser ignorado na segunda ocorrência por já existir tentativa.
- Se o runner atrasar mais que `maxDelayMinutes`, nada é enviado. Para recuperar
  uma janela perdida, use disparo manual com a data e `retry_failed=true`, depois
  de autorizar.
- Mantenha `sendTime + maxDelayMinutes` dentro do mesmo dia local. A janela atual
  não atravessa a meia-noite; para envios muito tarde da noite, use uma janela que
  termine antes de 23:59.
- O WhatsApp/Baileys pode exigir novo login, invalidar a sessão ou falhar. O
  runner não cria sessão nova e não exibe QR Code.
- A sessão é pessoal. Não compartilhe `.baileys-auth`, `session.enc.b64` ou a
  chave. Não rode dois processos usando a mesma sessão ao mesmo tempo.
- A conta pode ser restringida pelo WhatsApp. Use conteúdo consentido e evite
  comportamento de spam.
- O repositório privado e o GitHub Actions ainda são serviços de terceiros; o
  histórico do repositório privado pode reter versões antigas de sessão e estado.
  Considere políticas de retenção e rotação.
- O cliente usa a API Contents do GitHub, que devolve o conteúdo em base64 para
  arquivos pequenos. Sessões Baileys compactadas normalmente são pequenas, mas
  arquivos privados muito grandes exigiriam outro método de leitura/gravação.

## Solução de problemas

| Código/mensagem | Significado e ação |
| --- | --- |
| `CONFIG_ERROR` | configuração/programação inválida ou envio real sem confirmação. Leia a mensagem, corrija os arquivos e rode o dry-run. |
| `SESSION_MISSING` | não há sessão no repositório privado nem em `BAILEYS_SESSION_B64`. Crie/cifre a sessão localmente **com autorização** e envie ao local privado. |
| `SESSION_REQUIRES_QR` | a sessão precisa de novo login. O runner não cria sessão. Refaça o login local autorizado e recifre. |
| `SESSION_LOGGED_OUT` | o WhatsApp encerrou a sessão. Refaça o login local autorizado; não tente contornar com uma sessão nova automática. |
| login local: `401 loggedOut` | o WhatsApp encerrou a sessão antes de concluir. Remova o dispositivo antigo em "Aparelhos conectados", preserve a pasta e crie uma sessão nova. |
| login local: `428` / `503` | conexão fechada ou serviço indisponível. Verifique internet, VPN/proxy, firewall, relógio do sistema e tente novamente. |
| login local: `515 restartRequired` | o WhatsApp pediu reinício; o comando reconecta sozinho. Se repetir, preserve a pasta e tente `--resume`. |
| login local: `Tempo esgotado` | o QR não foi concluído em 5 minutos. Rode novamente, escaneie assim que o QR aparecer e mantenha o celular online e desbloqueado. |
| `SESSION_KEY_*` | `SESSION_ENCRYPTION_KEY` ausente, inválida ou diferente da usada para cifrar. Verifique o Secret, sem exibi-lo. |
| `GITHUB_AUTH` | PAT sem permissão de leitura/escrita no repositório privado. Revise o fine-grained PAT e o repositório. |
| `GITHUB_API` / `GITHUB_REDE` | falha temporária ou resposta inesperada da API. Verifique o status do GitHub e tente novamente. |
| `STATE_ERROR` | estado inválido, conflito de gravação ou falha ao salvar. Não apague o estado; confira o arquivo privado e evite execuções concorrentes. |
| `CONNECT_FAILED` / `CONNECT_TIMEOUT` | não foi possível abrir a conexão. Verifique rede, sessão e disponibilidade do WhatsApp; a data ficou marcada para retry manual. |
| `ACK_TIMEOUT` | a biblioteca aceitou o envio, mas o ACK não chegou. O status fica `unknown` e exige decisão manual; pode ter sido entregue. |
| `SEND_UNCONFIRMED` | a biblioteca não retornou o ID da mensagem. O status não é tratado como sucesso. |
| `before_window` / `missed_window` | execução antes ou depois da janela. Não houve envio. Use o disparo manual apropriado se precisar recuperar. |
| `already_attempted` | já houve tentativa real na data. Use `retry_failed` apenas para grupos pendentes, após verificar o estado. |

Nunca cole logs com IDs, links, títulos ou conteúdo de mensagens em issues públicas.
Ao relatar um problema, use apenas códigos de erro e contagens.

## Testes

```powershell
npm test
```

Os testes cobrem, entre outros:

- importação/parse do formato, validação, erros por linha, duplicidades e datas
  faltantes;
- cálculo de fuso, data local e janela de envio;
- montagem da mensagem e dia da semana;
- data sem registro e ausência de envio;
- idempotência por data/grupo e bloqueio de reenvio;
- retry controlado apenas dos grupos com falha/incerteza;
- dry-run sem conexão, envio ou gravação de estado;
- falha ao salvar estado antes/depois do envio;
- empacotamento, cifra e restauração da sessão;
- cliente do repositório privado e conflitos de SHA;
- falha de autenticação sem vazar token.

Os testes usam um gateway falso e diretórios temporários; não conectam ao WhatsApp,
não leem a configuração real e não fazem envio.

Build público:

```powershell
npm run pages:build
```

Ele falha de propósito se detectar dados privados no site.

## Antes do primeiro envio real

- [ ] O repositório privado existe e contém `data/config.json` e
      `data/schedule.json` válidos.
- [ ] Os IDs dos grupos foram conferidos e não estão no repositório público.
- [ ] O PAT fine-grained tem apenas Contents read/write no repositório privado.
- [ ] `PRIVATE_CONFIG_REPO`, `PRIVATE_CONFIG_TOKEN` e `SESSION_ENCRYPTION_KEY`
      estão configurados.
- [ ] A sessão existente foi preservada, cifrada e enviada como
      `data/session.enc.b64` (ou o bootstrap opcional está configurado).
- [ ] O dry-run manual no Actions terminou sem erros e sem conexão.
- [ ] O `state.json` privado foi salvo/backup e não será apagado.
- [ ] Você autorizou explicitamente o primeiro envio real.
- [ ] O workflow agendado está habilitado no branch padrão.
- [ ] O GitHub Pages está configurado com Source: GitHub Actions, se a interface
      pública for desejada.

Faça o primeiro teste real em um grupo de teste, com uma data controlada e
`retry_failed` desmarcado. Confirme o recebimento antes de habilitar o agendamento
para os grupos principais.

## Status da implementação

- Código, testes, workflows e documentação foram criados localmente.
- Nenhum commit, push, deploy, publicação no Pages ou envio real foi realizado.
- Uma sessão Baileys válida foi criada localmente; ela não é versionada e ainda não foi usada para envio.
- O arquivo real `links-meditacoes.txt` permanece fora do projeto e não foi
  copiado para o repositório.
- O uso real depende de autorização explícita, configuração do repositório
  privado, PAT, chave de cifra e sessão existente.
