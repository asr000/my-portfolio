import { plantStage } from './lib/garden.js'

export default function GardenPlant({ count = 0, variant = 0 }) {
  const stage = plantStage(count)
  return (
    <svg className={`garden-plant plant-${variant % 4}`} viewBox="0 0 160 200" aria-hidden="true">
      <ellipse className="plant-shadow" cx="80" cy="181" rx="47" ry="7" />
      <g className="plant-growth">
        <path className="plant-stem" d={stage === 'sprout' ? 'M80 139 Q76 114 83 95' : 'M80 139 Q70 94 85 52'} />
        <path className="plant-leaf" d="M79 119 Q45 121 46 95 Q73 93 79 119Z" />
        <path className="plant-leaf leaf-light" d="M80 104 Q112 107 117 80 Q89 78 80 104Z" />
        {stage !== 'sprout' && <path className="plant-leaf" d="M80 82 Q52 83 55 60 Q78 62 80 82Z" />}
        {stage === 'flower' ? (
          <g className="plant-flower">
            {[0, 60, 120, 180, 240, 300].map((angle) => (
              <ellipse key={angle} cx="85" cy="33" rx="11" ry="17" transform={`rotate(${angle} 85 50)`} />
            ))}
            <circle className="flower-center" cx="85" cy="50" r="11" />
          </g>
        ) : stage === 'leaf' ? (
          <path className="plant-bud" d="M85 56 Q68 39 86 25 Q104 43 85 56Z" />
        ) : <path className="plant-leaf leaf-light" d="M82 98 Q65 82 78 69 Q94 77 82 98Z" />}
      </g>
      <path className="plant-pot" d="M47 137 L55 174 Q80 187 105 174 L113 137Z" />
      <rect className="pot-rim" x="43" y="130" width="74" height="15" rx="5" />
      <path className="pot-mark" d="M72 160 Q80 168 88 160" />
    </svg>
  )
}
