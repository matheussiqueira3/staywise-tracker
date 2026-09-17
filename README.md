# Staywise Tracker

Controle mobile-first de permanência e simulação de dias no Brasil e em Schengen.

## Desenvolvimento

Use \`npm run dev\` e abra http://localhost:3000.

## Comandos

- \`npm run lint\` — lint do projeto
- \`npm run build\` — build de produção

## Dados

O histórico inicial foi migrado da planilha original para \`src/data/imported-trips.json\`.

O MVP mantém o workspace no navegador e permite compartilhar um link com os dados no fragmento da URL. O fragmento não é enviado ao servidor, mas qualquer pessoa que possua o link poderá ler e alterar os dados.

Os limites são configuráveis e servem como controle de permanência. O produto não determina residência fiscal, imigração ou obrigações tributárias.
