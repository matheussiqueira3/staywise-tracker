# Staywise Tracker

Calculadora mobile-first de permanência. Escolha um país ou regime, informe a entrada e o Staywise mostra quantos dias ainda cabem, o último dia seguro e o primeiro dia acima do limite.

## Desenvolvimento

Use \`npm run dev\` e abra http://localhost:3000.

## Comandos

- \`npm run lint\` — lint do projeto
- \`npm run build\` — build de produção

## Dados

O histórico inicial foi migrado da planilha original para \`src/data/imported-trips.json\`. Regras adicionais podem ser cadastradas em Mais antes de criar um cenário.

O workspace atual é compartilhado no servidor e usa a semântica de último salvamento vence. O link carrega todos os dados no fragmento da URL; qualquer pessoa que possua o link poderá ler e alterar o workspace. Não use este MVP para dados pessoais confidenciais.

Os limites são configuráveis e servem como controle de permanência. O produto não determina residência fiscal, imigração ou obrigações tributárias.
