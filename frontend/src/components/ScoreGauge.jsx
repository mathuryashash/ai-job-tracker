export default function ScoreGauge({ score }) {
  const r = 72;
  const cx = 100, cy = 100;
  const startAngle = 210;
  const endAngle = -30;
  const totalArc = 240;
  const progressArc = (score / 100) * totalArc;

  function polarToXY(angle, radius) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function arcPath(startDeg, endDeg, radius) {
    const start = polarToXY(startDeg, radius);
    const end = polarToXY(endDeg, radius);
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
  }

  const color = score >= 70 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
  const trackPath = arcPath(startAngle, startAngle - totalArc, r);
  const progressPath = arcPath(startAngle, startAngle - progressArc, r);

  return (
    <div className="gauge-wrapper">
      <svg viewBox="0 0 200 160" width="220" height="176">
        {/* Glow filter */}
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Track */}
        <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" strokeLinecap="round" />

        {/* Progress arc */}
        <path
          d={progressPath}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          filter="url(#glow)"
          style={{ transition: 'all 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />

        {/* Center score */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="32" fontWeight="800" fontFamily="Inter, sans-serif">
          {Math.round(score)}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill={color} fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif" letterSpacing="2">
          ATS SCORE
        </text>

        {/* Range labels */}
        <text x="28" y="130" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="Inter,sans-serif">0</text>
        <text x="172" y="130" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="Inter,sans-serif">100</text>
      </svg>

      <div className="text-xs text-muted" style={{ textAlign: 'center', marginTop: 4 }}>
        {score >= 70 ? '✅ Strong match — apply with confidence' : score >= 45 ? '⚠️ Moderate match — tailor your resume' : '❌ Low match — significant gaps detected'}
      </div>
    </div>
  );
}
