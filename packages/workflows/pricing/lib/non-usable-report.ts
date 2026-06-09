export type NonUsableReportRow = {
  sku: string;
  title?: string;
  status: string;
  price_mxn: number | null;
  title_matched?: string | null;
  match_decision?: string | null;
  match_reason_code?: string | null;
  match_reason?: string | null;
  usable_for_pricing?: boolean;
  failure_reason?: string | null;
  item_domain_id?: string | null;
  category_id?: string | null;
  ml_domain_validation?: {
    decision: string;
    categoria_interna?: string;
    ml_domain_id?: string;
    reason_code: string;
    reason: string;
  };
};

export type NonUsableReasonFamily =
  | 'sin_precio'
  | 'dominio_ml'
  | 'marca'
  | 'modelo_identidad'
  | 'precio_sospechoso'
  | 'sin_mapping'
  | 'revision_manual'
  | 'otro';

export type NonUsableReportItem = {
  sku: string;
  title: string;
  status: string;
  decision: string;
  price_mxn: number | null;
  family: NonUsableReasonFamily;
  human_reason: string;
  technical_reason_code: string;
  ml_domain: string;
  matched_title: string;
};

export type NonUsableReportGroup = {
  family: NonUsableReasonFamily;
  label: string;
  count: number;
  sample_skus: string[];
};

export type NonUsableReport = {
  generated_at: string;
  source_file: string;
  total_rows: number;
  usable_count: number;
  non_usable_count: number;
  groups: NonUsableReportGroup[];
  items: NonUsableReportItem[];
};

const familyLabels: Record<NonUsableReasonFamily, string> = {
  sin_precio: 'Sin precio usable en Mercado Libre',
  dominio_ml: 'Mercado Libre devolvio otra familia/categoria',
  marca: 'La marca real no coincide',
  modelo_identidad: 'Falta modelo o identidad fuerte',
  precio_sospechoso: 'Precio sospechoso contra Mi Pase',
  sin_mapping: 'Falta mapping de categoria/dominio',
  revision_manual: 'Requiere revision humana',
  otro: 'Otro motivo',
};

function reasonCode(row: NonUsableReportRow): string {
  return row.match_reason_code
    ?? row.ml_domain_validation?.reason_code
    ?? row.failure_reason
    ?? row.status
    ?? 'sin_reason_code';
}

export function classifyNonUsableReason(row: NonUsableReportRow): NonUsableReasonFamily {
  if (row.usable_for_pricing) return 'otro';

  const code = reasonCode(row);

  if (row.price_mxn == null || row.status === 'no_listings' || row.status === 'no_catalog_match' || row.status === 'no_mxn_price') {
    return 'sin_precio';
  }

  if (code === 'ml_domain_no_mapping' || row.ml_domain_validation?.decision === 'no_mapping') {
    return 'sin_mapping';
  }

  if (code.startsWith('ml_domain_')) {
    return 'dominio_ml';
  }

  if (code === 'brand_mismatch') {
    return 'marca';
  }

  if (code === 'brand_and_model_missing' || code === 'forbidden_terms_found') {
    return 'modelo_identidad';
  }

  if (code === 'price_outlier_low' || code === 'price_outlier_high') {
    return 'precio_sospechoso';
  }

  if (row.match_decision === 'manual_review') {
    return 'revision_manual';
  }

  return 'otro';
}

function humanReason(row: NonUsableReportRow, family: NonUsableReasonFamily): string {
  if (row.match_reason) return row.match_reason;
  if (row.ml_domain_validation?.reason) return row.ml_domain_validation.reason;
  if (row.failure_reason) return row.failure_reason;
  return familyLabels[family];
}

export function buildNonUsableReport(input: {
  rows: NonUsableReportRow[];
  sourceFile: string;
  generatedAt?: string;
}): NonUsableReport {
  const items = input.rows
    .filter((row) => !row.usable_for_pricing)
    .map((row) => {
      const family = classifyNonUsableReason(row);
      return {
        sku: row.sku,
        title: row.title ?? '',
        status: row.status,
        decision: row.match_decision ?? '',
        price_mxn: row.price_mxn,
        family,
        human_reason: humanReason(row, family),
        technical_reason_code: reasonCode(row),
        ml_domain: row.item_domain_id ?? row.category_id ?? row.ml_domain_validation?.ml_domain_id ?? '',
        matched_title: row.title_matched ?? '',
      };
    });

  const groupsByFamily = new Map<NonUsableReasonFamily, NonUsableReportGroup>();

  for (const item of items) {
    const group = groupsByFamily.get(item.family) ?? {
      family: item.family,
      label: familyLabels[item.family],
      count: 0,
      sample_skus: [],
    };

    group.count++;
    if (group.sample_skus.length < 8) group.sample_skus.push(item.sku);
    groupsByFamily.set(item.family, group);
  }

  return {
    generated_at: input.generatedAt ?? new Date().toISOString(),
    source_file: input.sourceFile,
    total_rows: input.rows.length,
    usable_count: input.rows.filter((row) => row.usable_for_pricing).length,
    non_usable_count: items.length,
    groups: [...groupsByFamily.values()].sort((a, b) => b.count - a.count || a.family.localeCompare(b.family)),
    items,
  };
}

function mdCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function money(value: number | null): string {
  if (value == null) return '';
  return `$${value.toFixed(2)} MXN`;
}

export function buildNonUsableReportMarkdown(report: NonUsableReport): string {
  const lines = [
    '# Reporte de productos no usables',
    '',
    `Generado: ${report.generated_at}`,
    `Fuente: ${report.source_file}`,
    '',
    '## Resumen',
    '',
    `- Productos analizados: ${report.total_rows}`,
    `- Usables para pricing automatico: ${report.usable_count}`,
    `- No usables/revision: ${report.non_usable_count}`,
    '',
    '## Motivos principales',
    '',
    '| Motivo | Cantidad | SKUs muestra |',
    '| --- | ---: | --- |',
    ...report.groups.map((group) => `| ${mdCell(group.label)} | ${group.count} | ${mdCell(group.sample_skus.join(', '))} |`),
    '',
    '## Detalle',
    '',
    '| SKU | Decision | Precio ML | Motivo humano | Codigo tecnico | Dominio ML | Titulo encontrado |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
    ...report.items.map((item) => [
      item.sku,
      item.decision || item.status,
      money(item.price_mxn),
      item.human_reason,
      item.technical_reason_code,
      item.ml_domain,
      item.matched_title,
    ].map(mdCell).join(' | ')).map((line) => `| ${line} |`),
    '',
  ];

  return lines.join('\n');
}

export function buildNonUsableReportCsv(report: NonUsableReport): string {
  const header = [
    'sku',
    'decision',
    'price_mxn',
    'family',
    'human_reason',
    'technical_reason_code',
    'ml_domain',
    'matched_title',
  ];
  const rows = report.items.map((item) => [
    item.sku,
    item.decision || item.status,
    item.price_mxn == null ? '' : String(item.price_mxn),
    item.family,
    item.human_reason,
    item.technical_reason_code,
    item.ml_domain,
    item.matched_title,
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
