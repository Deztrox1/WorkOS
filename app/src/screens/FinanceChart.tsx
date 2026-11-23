import { useState } from 'react';
import { niceTicks, type MonthSummary } from '../lib/logic/finance';
import { monthLabel, usd } from '../lib/logic/format';

const W = 720, H = 250, PL = 50, PR = 92, PT = 16, PB = 40, R = 4;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const axis = (v: number) => (Math.abs(v) >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${v}`).replace('$-', '-$');
const val = (n: number) => usd(Math.round(n));

/** A bar with rounded top corners only, sitting on the baseline. */
function bar(x: number, w: number, base: number, top: number) {
  const h = base - top;
  if (h <= 0) return '';
  const r = Math.min(R, w / 2, h);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

export function FinanceChart({ data, target }: { data: MonthSummary[]; target: number }) {
  const [tip, setTip] = useState<number | null>(null);
  const ticks = niceTicks(Math.min(...data.map((d) => d.profit)), Math.max(target, ...data.flatMap((d) => [d.revenue, d.costs, d.profit])));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
  const gw = (W - PL - PR) / data.length;
  const bw = Math.min(14, gw * 0.3);
  const cx = (i: number) => PL + i * gw + gw / 2;
  const last = data[data.length - 1];
  const t = tip === null ? null : data[tip];
  const tw = 128, th = 70;
  const tx = tip === null ? 0 : Math.min(Math.max(cx(tip) - tw / 2, PL), W - PR - tw + 40);
  return (
    <div>
      <ul className="chart-legend" aria-label="Legend">
        <li><i style={{ background: 'var(--acc)' }} />Revenue</li>
        <li><i style={{ background: 'var(--mute)' }} />Costs</li>
        <li><i className="ln" />Profit</li>
      </ul>
      <div className="chart-scroll" ref={(el) => { if (el && !el.dataset.seen) { el.dataset.seen = '1'; el.scrollLeft = el.scrollWidth; } }}>
        <div className="chart-row">
        {/* The y-axis is its own strip, pinned to the left edge while the months scroll under it. */}
        <div className="chart-axis" aria-hidden>
          <svg viewBox={`0 0 ${PL} ${H}`} width={PL} height={H}>
            {ticks.map((v) => <text key={v} x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--fg2)" fontFamily="var(--font-mono)">{axis(v)}</text>)}
          </svg>
        </div>
        <svg viewBox={`${PL} 0 ${W - PL} ${H}`} className="chart-main" role="img" aria-label="Revenue, costs and profit for 12 months, in USD" data-testid="fin-chart" onMouseLeave={() => setTip(null)}>
          {ticks.map((v) => (
            <g key={v} data-testid="y-tick" data-value={axis(v)}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeOpacity={v === 0 ? 1 : 0.6} />
            </g>
          ))}
          <line x1={PL} x2={W - PR + 6} y1={y(target)} y2={y(target)} stroke="var(--line)" strokeWidth="1.5" strokeDasharray="5 4" data-testid="target-line" style={{ filter: 'brightness(0.8)' }} />
          <text x={W - PR + 10} y={y(target) + 4} fontSize="11" fill="var(--fg2)" data-testid="target-label">target {usd(target)}</text>
          {data.map((d, i) => {
            const [yr, mo] = d.month.split('-').map(Number);
            return (
              <g key={d.month} data-testid="fin-month" data-month={d.month}>
                <path d={bar(cx(i) - bw - 1, bw, y(0), y(d.revenue))} fill="var(--acc)" data-testid="rev-bar" />
                <path d={bar(cx(i) + 1, bw, y(0), y(d.costs))} fill="var(--mute)" data-testid="cost-bar" />
                <text x={cx(i)} y={H - 20} textAnchor="middle" fontSize="11" fill="var(--fg2)">{MON[mo - 1]}</text>
                {mo === 1 && <text x={cx(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--fg2)" fontFamily="var(--font-mono)">{yr}</text>}
                <rect x={PL + i * gw} y={PT} width={gw} height={H - PT - PB} fill="transparent" data-testid="month-hit" onMouseEnter={() => setTip(i)} onClick={() => setTip(tip === i ? null : i)} />
              </g>
            );
          })}
          <polyline fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinejoin="round" data-testid="profit-line" pointerEvents="none" points={data.map((d, i) => `${cx(i)},${y(d.profit)}`).join(' ')} />
          {data.map((d, i) => <circle key={d.month} cx={cx(i)} cy={y(d.profit)} r="4" fill={d.profit < 0 ? 'var(--bad)' : 'var(--fg)'} stroke="var(--paper)" strokeWidth="1.5" pointerEvents="none" data-testid="profit-dot" data-neg={d.profit < 0} />)}
          <text x={cx(data.length - 1)} y={y(last.profit) - 10} textAnchor="end" fontSize="12" fontWeight="600" fontFamily="var(--font-mono)" fill={last.profit < 0 ? 'var(--bad)' : 'var(--fg)'} data-testid="profit-last" pointerEvents="none">{val(last.profit)}</text>
          {t && tip !== null && (
            <g data-testid="fin-tip" pointerEvents="none">
              <rect x={tx} y={PT} width={tw} height={th} rx="6" fill="var(--paper)" stroke="var(--line)" />
              <text x={tx + 10} y={PT + 18} fontSize="11" fontWeight="600" fill="var(--fg)">{monthLabel(t.month)}</text>
              <text x={tx + 10} y={PT + 35} fontSize="11" fill="var(--fg2)" fontFamily="var(--font-mono)">Revenue {val(t.revenue)}</text>
              <text x={tx + 10} y={PT + 50} fontSize="11" fill="var(--fg2)" fontFamily="var(--font-mono)">Costs {val(t.costs)}</text>
              <text x={tx + 10} y={PT + 65} fontSize="11" fill={t.profit < 0 ? 'var(--bad)' : 'var(--fg)'} fontFamily="var(--font-mono)">Profit {val(t.profit)}</text>
            </g>
          )}
        </svg>
        </div>
      </div>
    </div>
  );
}
