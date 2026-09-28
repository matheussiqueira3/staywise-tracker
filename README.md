# Staywise Tracker

Calculadora mobile-first de permanência. Escolha um país ou regime, informe a entrada e o Staywise mostra quantos dias ainda cabem, o último dia seguro e o primeiro dia acima do limite.

## Desenvolvimento

Use \`npm run dev\` e abra http://localhost:3000.

## Comandos

- \`npm test\` — testes das regras e da sincronização
- \`npm run lint\` — lint do projeto
- \`npm run build\` — build de produção

## Sincronização e acesso

O estado fica no Upstash Redis (\`UPSTASH_REDIS_REST_URL\`, \`UPSTASH_REDIS_REST_TOKEN\`) via \`/api/state\`.

- O app é público e de uso pessoal (um único workspace): a API não exige login nem código de acesso. Qualquer pessoa com o endereço do app pode ver e alterar os dados.
- Cada escrita envia a revisão em que se baseia. O servidor recusa escritas desatualizadas (409); o app carrega a versão mais recente e guarda a alteração recusada em \`localStorage\` (\`staywise-state-conflict-backup\`).
- Sem servidor, o app trabalha em modo local e não envia nada. As alterações locais só são enviadas depois se o servidor não tiver mudado nesse meio-tempo; caso contrário, a versão do servidor vence e a local vira cópia de segurança.
- Valores gravados antes das revisões são lidos como revisão 0.

## Dados

O histórico inicial foi migrado da planilha original para \`src/data/imported-trips.json\`. Ele é usado apenas no servidor, para preencher um armazenamento vazio, e não é incluído no JavaScript enviado ao navegador. Regras adicionais (outros países) podem ser cadastradas em Mais antes de criar um cenário.

O MVP mantém o workspace no navegador e permite compartilhar um link com os dados no fragmento da URL. O fragmento não é enviado ao servidor, mas qualquer pessoa que possua o link poderá ler e alterar os dados.

As regras do catálogo são Itália (90 dias em qualquer janela de 180), Brasil (180 dias em qualquer janela de 360) e, opcional, Schengen (90 em 180). Regras do catálogo sempre usam os números do catálogo. O estado guardado tem um campo `version`; dados antigos são migrados ao serem lidos (estadias "Schengen" na Itália viram estadias na Itália). O produto conta dias e não determina residência fiscal, imigração ou obrigações tributárias.
