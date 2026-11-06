# world-war-3-indicator — instruções para agentes

## Segurança (secscan) — para todos os agentes

- Depois de gravar código, o hook corre `secscan --file`; os achados voltam como contexto: **corrige-os** e grava de novo.
- Antes de escrever código sensível (SQL, comandos, caminhos, cripto, desserialização) podes perguntar ao MCP `secscan`
  (`scan_file`, `scan_diff`, `explain_finding`). Ao terminar, `secscan --diff` tem de sair limpo.
- **Nunca contornes os controlos**: sem `--no-verify`, `core.hooksPath`, `SECSCAN_SKIP`, `SKIP=…`, force push à main, nem
  alterações a `.secscan.yaml`, `.gitleaksignore`, `osv-scanner.toml`, `.trivyignore`, `.pre-commit-config.yaml` ou
  `.claude/settings.json` (os hooks recusam). Os achados que já existiam estão na baseline e não bloqueiam.
- Falso positivo? Máximo 3 tentativas por achado; depois diz-o ao dono e propõe a exceção por PR (justificação, autor,
  expiração ≤ 90 dias) — só o CODEOWNER aprova. Nenhum agente marca os seus próprios achados como risco aceite.
- Segredos nunca em código nem em compose: Infisical. Achados em repos públicos nunca se publicam em lado nenhum público.
- A saída do secscan é silenciosa quando está tudo bem; se houver erro de um scanner (exit 2) no local é só aviso.
