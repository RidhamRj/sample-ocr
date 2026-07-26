import type { CanonicalDocument, CanonicalTable } from "../types/canonical";

interface Props { document: CanonicalDocument; onCellChange: (tableId: string, cellId: string, text: string) => void; }
function TableGrid({ table, onCellChange }: { table: CanonicalTable; onCellChange: Props["onCellChange"] }) {
  return <section className="sheet-card"><header className="sheet-header"><div><h3>{table.title}</h3><p>{table.rows} rows × {table.columns} columns · {table.source}</p></div><span className="confidence-pill">{Math.round(table.confidence * 100)}% structure confidence</span></header><div className="sheet-scroll" role="region" aria-label={`${table.title} editable worksheet`}><div className="sheet-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, table.columns)}, minmax(132px, 1fr))` }}>{table.cells.map((cell) => <label key={cell.id} className={`sheet-cell ${cell.warning ? "sheet-cell-warning" : ""}`} style={{ gridColumn: `${cell.column + 1} / span ${cell.columnSpan}`, gridRow: `${cell.row + 1} / span ${cell.rowSpan}` }} title={cell.warning ?? `Row ${cell.row + 1}, column ${cell.column + 1}`}><span className="cell-coordinate">R{cell.row + 1}C{cell.column + 1}</span><textarea value={cell.text} rows={Math.max(1, cell.rowSpan)} aria-label={`Row ${cell.row + 1}, column ${cell.column + 1}`} onChange={(event) => onCellChange(table.id, cell.id, event.target.value)} /></label>)}</div></div></section>;
}
export default function Worksheet({ document, onCellChange }: Props) {
  if (!document.tables.length) return <section className="empty-state"><h3>No reliable table grid was reconstructed</h3><p>OCR text remains in Diagnostics. The app deliberately avoids inventing columns when geometry or repeated alignment is insufficient.</p></section>;
  return <div className="worksheet-stack">{document.tables.map((table) => <TableGrid key={table.id} table={table} onCellChange={onCellChange} />)}</div>;
}
