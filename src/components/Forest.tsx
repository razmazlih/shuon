export function Forest({ alert }: { alert: boolean }) {
  return (
    <svg className="forest" viewBox="0 0 300 232" fill="none" aria-hidden="true">
      <defs>
        <pattern id="print-dots" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" fill="var(--forest-moon-texture, #826d41)" opacity=".32" />
        </pattern>
        <pattern id="grass-lines" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="m1 6 2-3" stroke="var(--forest-grass-texture, #51643c)" strokeWidth=".8" opacity=".55" />
        </pattern>
        <g id="fir">
          <path d="m0 0-9 20h4l-10 15h7l-12 18h40L8 35h7L5 20h4Z" />
          <path d="M0 15v46" stroke="currentColor" strokeWidth="2" />
        </g>
      </defs>
      <circle cx="94" cy="89" r="47" fill="var(--forest-moon, #ecd293)" />
      <circle cx="94" cy="89" r="47" fill="url(#print-dots)" />
      <g stroke="var(--forest-sky-detail, #bcaa79)" strokeWidth="1.5" strokeLinecap="round">
        <path d="m89 30-1-6m-23 14-4-5m-15 21-6-3m77-17 3-6m15 19 5-4" />
        <path d="M30 94q4-4 8 0 4-4 8-1m114-35q4-4 8 0 4-5 8-2" />
      </g>
      <path d="M-15 147q45-47 103-29 46-39 103-6 39 20 94 10v81H-15Z" fill="var(--forest-hill-far, #c7cda3)" />
      <path d="M-12 152q44 7 96-13 50-18 102 3 47 19 116-6v65H-12Z" fill="var(--forest-hill-near, #a1b185)" />
      <g fill="var(--forest-fir-far, #879976)" color="var(--forest-fir-far-trunk, #798969)">
        <use href="#fir" transform="translate(19 80) scale(.95)" />
        <use href="#fir" transform="translate(33 99) scale(.76)" />
        <use href="#fir" transform="translate(233 94) scale(.67)" />
        <use href="#fir" transform="translate(249 81) scale(.88)" />
      </g>
      <g fill="var(--forest-fir-near, #566e58)" color="var(--forest-fir-near-trunk, #516751)">
        <use href="#fir" transform="translate(9 104) scale(1.05)" />
        <use href="#fir" transform="translate(48 102) scale(.87)" />
        <use href="#fir" transform="translate(224 117) scale(.75)" />
      </g>
      <path d="M-13 169q52-32 119-13 47 13 91-2 41-14 110 11v48H-13Z" fill="var(--forest-meadow, #849769)" />
      <path d="M-14 184q42-22 99-13 58 11 102-5 59-17 122 8v72H-14Z" fill="var(--forest-foreground, #687e56)" />
      <path d="M-12 180q43-15 77-8m126-9q42-13 79-6" stroke="var(--forest-grass-edge, #536a4c)" strokeWidth="2" strokeLinecap="round" />
      <path d="M-8 191q58-26 150-8 63 13 163-12v70H-8Z" fill="url(#grass-lines)" />
      <ellipse cx="134" cy="192" rx="59" ry="8" fill="var(--forest-shadow, #43533b)" opacity=".4" />
      <g className="forest-fox" stroke="#684837" strokeLinejoin="round" strokeLinecap="round">
        <path d="M109 148q-10 14-15 34-2 8 7 9l39 1q17-1 19-15 1-10-9-33Z" fill="#c8693e" strokeWidth="2.4" />
        <path d="M128 151q8 19 0 39h18q8-15 3-36Z" fill="#f9dfb1" strokeWidth="1.4" />
        <g className="forest-fox-tail">
          <path
            d="M104 157q-15 6-22 1-9-6-7-23-23 12-17 33 6 23 39 23 21 1 29-11 6-8-2-13-8-4-20-10Z"
            fill="#df8145"
            strokeWidth="2.4"
          />
          <path d="M75 135q-17 9-18 25l7-4 2 8 7-3 3 6q4-4 7-9-10-7-8-23Z" fill="#fce8bf" strokeWidth="1.5" />
        </g>
        <g className="forest-fox-head">
          <path
            d="m100 112-4-27q0-3 3-1l24 17q10-3 20 0l23-19q3-2 4 2l-2 30q8 16-2 27-12 13-31 20-23-5-36-21-8-13 1-28Z"
            fill="#da7d45"
            strokeWidth="2.4"
          />
          <path d="m102 92 4 18 11-7zm61-1-13 13 12 5Z" fill="#84523f" strokeWidth="1.4" />
          <path
            d="M96 126q15-3 29 12l9 10 9-11q14-15 29-14-5 23-37 37-27-8-39-34Z"
            fill="#ffebc6"
            strokeWidth="1.4"
          />
          {alert ? (
            <g className="forest-fox-eyes" fill="#493e32" stroke="none">
              <ellipse cx="113" cy="127" rx="3.2" ry="3.9" />
              <ellipse cx="153" cy="126" rx="3.2" ry="3.9" />
              <g fill="#fff1d3">
                <circle cx="114" cy="125.6" r=".95" />
                <circle cx="154" cy="124.6" r=".95" />
              </g>
            </g>
          ) : (
            <path d="M107 126q6 7 12 1m28 0q6 6 12-2" stroke="#4b4034" strokeWidth="2.6" />
          )}
          <path d="m129 143 6 7 7-8q-7-2-13 1Z" fill="#493e32" strokeWidth="1.1" />
          <path d="m136 149-1 4m-15-39 5 3m23-5-4 4" strokeWidth="1.4" />
        </g>
        <path d="M138 174q-1 10-3 15m14-15q2 11 0 16" strokeWidth="1.6" />
        <path d="M132 190q4-2 8 0m2 1q6-2 11 0" strokeWidth="3" />
      </g>
      <g stroke="var(--forest-stems, #475f46)" strokeWidth="1.9" strokeLinecap="round">
        <path d="m25 180-1-6m1 6 4-4m154 12 1-5m0 4 3-3m53-12-1-6m1 5 4-3m-181 25 2-4" />
      </g>
      <g fill="var(--forest-flowers, #ddbf71)">
        <circle cx="25" cy="173" r="2" />
        <circle cx="241" cy="166" r="2" />
        <circle cx="204" cy="176" r="1.6" />
      </g>
    </svg>
  )
}
