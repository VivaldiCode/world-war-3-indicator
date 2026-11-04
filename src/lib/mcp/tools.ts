import type { CompositeIndex, DataSource, SourceCategory, SourceReading } from '../types';

export type SourceMeta = Omit<DataSource, 'fetch' | 'backfill'>;

/** Everything the tools read. Injected so tests never touch SQLite. */
export interface McpData {
  now(): number;
  refreshIntervalMs: number;
  sources: SourceMeta[];
  latestComposite(): CompositeIndex | null;
  compositeHistory(limit: number): Array<{ computedAt: string; score: number; band: string }>;
  latestReading(sourceId: string): SourceReading | null;
  readingHistory(sourceId: string, limit: number): SourceReading[];
}

export class ToolInputError extends Error {}

/** A composite may miss two scheduler ticks before it counts as stale. */
const COMPOSITE_STALE_TICKS = 3;
const CATEGORIES: SourceCategory[] = ['markets', 'conflicts', 'sentiment', 'military', 'diplomacy'];

function ageSeconds(data: McpData, iso: string): number {
  return Math.max(0, Math.round((data.now() - Date.parse(iso)) / 1000));
}

function compositeStaleAfterSec(data: McpData): number {
  return Math.round((COMPOSITE_STALE_TICKS * data.refreshIntervalMs) / 1000);
}

function compositeAvailability(data: McpData, composite: CompositeIndex | null) {
  if (!composite) {
    return { fresh: false, valid: false, invalidReason: 'no_composite' as string | null };
  }
  const fresh = ageSeconds(data, composite.computedAt) <= compositeStaleAfterSec(data);
  // With no OK source the engine still emits score 0 / green: that is "no data", not "peace".
  const anyOk = composite.contributors.some((c) => c.ok);
  const invalidReason = !anyOk ? 'no_ok_sources' : !fresh ? 'stale_composite' : null;
  return { fresh, valid: invalidReason === null, invalidReason };
}

function tensaoGlobal(data: McpData) {
  const composite = data.latestComposite();
  const availability = compositeAvailability(data, composite);
  const staleAfterSeconds = compositeStaleAfterSec(data);
  if (!composite) {
    return {
      score: null,
      scoreDisplay: null,
      scale: '0-100',
      band: null,
      computedAt: null,
      ageSeconds: null,
      staleAfterSeconds,
      ...availability,
      okSources: 0,
      totalSources: data.sources.length,
      weightCoverage: 0,
      failedSources: [],
      categories: null,
    };
  }
  const okIds = new Set(composite.contributors.filter((c) => c.ok).map((c) => c.sourceId));
  const totalWeight = data.sources.reduce((sum, s) => sum + s.weight, 0);
  const okWeight = data.sources.reduce((sum, s) => sum + (okIds.has(s.id) ? s.weight : 0), 0);
  return {
    score: composite.score,
    scoreDisplay: Number(composite.score.toFixed(1)),
    scale: '0-100',
    band: composite.band,
    computedAt: composite.computedAt,
    ageSeconds: ageSeconds(data, composite.computedAt),
    staleAfterSeconds,
    ...availability,
    okSources: okIds.size,
    totalSources: data.sources.length,
    weightCoverage: totalWeight > 0 ? okWeight / totalWeight : 0,
    failedSources: composite.contributors
      .filter((c) => !c.ok)
      .map((c) => ({ id: c.sourceId, name: c.name, error: c.error ?? null })),
    categories: composite.categories,
  };
}

function indicadores(data: McpData, args: Record<string, unknown>) {
  const categoria = args.categoria;
  if (categoria !== undefined && !CATEGORIES.includes(categoria as SourceCategory)) {
    throw new ToolInputError(`categoria desconhecida; válidas: ${CATEGORIES.join(', ')}`);
  }
  const composite = data.latestComposite();
  if (!composite) return { computedAt: null, indicadores: [] };
  return {
    computedAt: composite.computedAt,
    indicadores: composite.contributors
      .filter((c) => categoria === undefined || c.category === categoria)
      .sort((a, b) => b.contribution - a.contribution)
      .map((c) => ({ ...c, error: c.error ?? null, ageSeconds: ageSeconds(data, c.measuredAt) })),
  };
}

function limitArg(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ToolInputError('limite tem de ser um inteiro maior que zero');
  }
  return Math.min(value, max);
}

function indicador(data: McpData, args: Record<string, unknown>) {
  const source = data.sources.find((s) => s.id === args.id);
  if (!source) {
    throw new ToolInputError(`indicador desconhecido; válidos: ${data.sources.map((s) => s.id).join(', ')}`);
  }
  const limite = limitArg(args.limite, 30, 90);
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    provider: source.provider,
    providerUrl: source.providerUrl,
    category: source.category,
    weight: source.weight,
    refreshIntervalSec: source.refreshIntervalSec,
    unit: source.unit ?? null,
    scoringExplanation: source.scoringExplanation,
    latest: data.latestReading(source.id),
    history: data.readingHistory(source.id, limite).map((r) => ({
      measuredAt: r.measuredAt,
      score: r.score,
      band: r.band,
      raw: r.raw,
      ok: r.ok,
    })),
  };
}

function historico(data: McpData, args: Record<string, unknown>) {
  return { history: data.compositeHistory(limitArg(args.limite, 90, 1000)) };
}

function frescura(data: McpData) {
  const composite = data.latestComposite();
  const intervalSec = Math.round(data.refreshIntervalMs / 1000);
  return {
    computedAt: composite?.computedAt ?? null,
    ageSeconds: composite ? ageSeconds(data, composite.computedAt) : null,
    staleAfterSeconds: compositeStaleAfterSec(data),
    ...compositeAvailability(data, composite),
    refreshIntervalSeconds: intervalSec,
    sources: data.sources.map((s) => {
      const latest = data.latestReading(s.id);
      // A source is refreshed on the first tick after its own interval runs out.
      const staleAfterSeconds = 2 * s.refreshIntervalSec + intervalSec;
      const age = latest ? ageSeconds(data, latest.measuredAt) : null;
      const lastOk = latest?.ok ? latest : data.readingHistory(s.id, 90).find((r) => r.ok);
      return {
        id: s.id,
        name: s.name,
        ok: latest?.ok ?? false,
        fresh: Boolean(latest?.ok) && age !== null && age <= staleAfterSeconds,
        measuredAt: latest?.measuredAt ?? null,
        ageSeconds: age,
        staleAfterSeconds,
        lastOkAt: lastOk?.measuredAt ?? null,
        error: latest?.error ?? null,
      };
    }),
  };
}

const limiteSchema = (fallback: number, max: number) => ({
  type: 'integer',
  minimum: 1,
  maximum: max,
  default: fallback,
  description: `Número de pontos, do mais recente para o mais antigo (máximo ${max}).`,
});

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(data: McpData, args: Record<string, unknown>): unknown;
}

const noInput = { type: 'object', properties: {}, additionalProperties: false };

export const TOOLS: Tool[] = [
  {
    name: 'ww3_tensao_global',
    title: 'Tensão global',
    description:
      'Valor actual da tensão global (0 a 100, 0 = paz, 100 = à beira do conflito), com a hora da última actualização. ' +
      '`score` traz a precisão total e `scoreDisplay` o valor com uma casa decimal, como na página. ' +
      'Antes de usar o valor numa decisão, confirmar `valid`: é false se não há composto, se está antigo ou se nenhuma fonte respondeu (`invalidReason`).',
    inputSchema: noInput,
    run: (data) => tensaoGlobal(data),
  },
  {
    name: 'ww3_indicadores',
    title: 'Indicadores',
    description:
      'Todos os indicadores do composto actual, do que mais contribui para o que menos: score, peso, contribuição, valor original, explicação, hora da medição e erro, se falhou.',
    inputSchema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', enum: CATEGORIES, description: 'Limita a uma categoria.' },
      },
      additionalProperties: false,
    },
    run: indicadores,
  },
  {
    name: 'ww3_indicador',
    title: 'Detalhe de um indicador',
    description:
      'Um indicador: fonte, como é calculado o score, última leitura e histórico. Os ids vêm de `ww3_indicadores`.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id do indicador, por exemplo gold-spot.' },
        limite: limiteSchema(30, 90),
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: indicador,
  },
  {
    name: 'ww3_historico',
    title: 'Histórico da tensão global',
    description: 'Valores anteriores da tensão global, com a hora de cada um, do mais recente para o mais antigo.',
    inputSchema: {
      type: 'object',
      properties: { limite: limiteSchema(90, 1000) },
      additionalProperties: false,
    },
    run: historico,
  },
  {
    name: 'ww3_frescura',
    title: 'Frescura dos dados',
    description:
      'Idade do composto e de cada fonte: quando mediu, quando foi a última leitura boa, se está dentro do prazo e o erro actual.',
    inputSchema: noInput,
    run: (data) => frescura(data),
  },
];
