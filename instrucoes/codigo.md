# Regras de código

- Função de 4 a 40 linhas; arquivo abaixo de 500; máximo 2 níveis de indentação,
  com retorno antecipado. Uma responsabilidade por função e por módulo.
- Nomes específicos e únicos. Proibidos `data`, `handler`, `manager`, `utils`,
  `helpers`, `info`, `process`, `item`.
- Tipos explícitos; entrada externa validada em toda fronteira.
- Segunda ocorrência: extraia. Formato igual com significado diferente não é duplicação.
- Mensagem de erro inclui o valor ofensor e o formato esperado.
- Preserve comentários; escreva o porquê. Sem ID de ticket em comentário (só `DT-NNN` em `TODO`).
- Dependências injetadas; sem singleton nem estado global mutável; lib de terceiros
  atrás de interface própria.
- Log estruturado, com campos; nunca senha, token ou documento pessoal completo.
- Teste rápido, independente e repetível. Fake nomeado para I/O externo; sem `sleep`;
  nome descreve o comportamento.
