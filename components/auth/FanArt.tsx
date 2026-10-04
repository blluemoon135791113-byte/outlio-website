/**
 * The Outlio fan artwork, re-rendered as native vector from the reference's
 * measured geometry and exact sampled colours — on its cream ground (variant A).
 * Every stripe, the cone (with faint striations), the curl lip, the leader rays
 * and the frame are real DOM; every colour is a CSS variable scoped to `.fanart`.
 * The fans hug the right/bottom frame edges symmetrically and are clipped to the
 * frame rectangle so nothing spills past a node. Decorative (aria-hidden).
 */
export function FanArt({ className }: { className?: string }) {
  return (
    <svg
      className={`fanart${className ? ` ${className}` : ''}`}
      viewBox="50 52 638 842"
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
    >
      <style>{`.fanart{background:var(--fan-bg);--fan-bg:#f0e7ca;--fan-o0:#ef6f04;--fan-o1:#f97b0c;--fan-o2:#ff8d1f;--fan-o3:#e4680a;--fan-o4:#f5790e;--fan-cone:#252b29;--fan-ck0:#333b35;--fan-ck1:#2b322d;--fan-curl:#d8d4bc;--fan-cus:#b7b096;--fan-line:#2a281f;--fan-dot:#1f1d16;--fan-grain:#8f865f}.fanart .fo0{stroke:var(--fan-o0)}.fanart .fo1{stroke:var(--fan-o1)}.fanart .fo2{stroke:var(--fan-o2)}.fanart .fo3{stroke:var(--fan-o3)}.fanart .fo4{stroke:var(--fan-o4)}.fanart .fo0,.fanart .fo1,.fanart .fo2,.fanart .fo3,.fanart .fo4{stroke-width:1.2px}.fanart .fk0{stroke:var(--fan-ck0)}.fanart .fk1{stroke:var(--fan-ck1)}.fanart .fk0,.fanart .fk1{stroke-width:1px}.fanart .fcs{stroke:var(--fan-cus);stroke-width:1.1px}.fanart .fln{stroke:var(--fan-line);stroke-width:1px}.fanart .fdot{fill:var(--fan-dot)}.fanart .fgr{fill:var(--fan-grain)}`}</style>
      <rect x="50" y="52" width="638" height="842" fill="var(--fan-bg)" />
      <clipPath id="fanart-frame">
        <rect x="92" y="94" width="554" height="758" />
      </clipPath>
      <g clipPath="url(#fanart-frame)">
        <g><line className="fln" x1="642.0" y1="846.0" x2="92" y2="243" strokeOpacity="0.75"/>
<line className="fln" x1="642.0" y1="846.0" x2="92" y2="405" strokeOpacity="0.75"/>
<line className="fln" x1="642.0" y1="846.0" x2="92" y2="530" strokeOpacity="0.75"/>
<line className="fln" x1="642.0" y1="846.0" x2="279" y2="94" strokeOpacity="0.75"/>
<line className="fln" x1="642.0" y1="846.0" x2="429" y2="94" strokeOpacity="0.75"/>
<line className="fln" x1="642.0" y1="846.0" x2="92" y2="94" strokeOpacity="0.75"/></g>
        <path d="M 642.0,846.0 L 541.7,411.4 L 537.8,412.1 L 534.0,412.8 L 530.2,413.6 L 526.3,414.3 L 522.5,415.1 L 518.7,416.0 L 514.9,416.9 L 511.1,417.8 L 507.3,418.7 L 503.5,419.7 L 499.7,420.7 L 495.9,421.7 L 492.1,422.8 L 488.4,423.9 L 484.6,425.1 L 480.9,426.3 L 477.1,427.5 L 473.4,428.7 L 469.7,430.0 L 466.0,431.3 L 462.3,432.7 L 458.6,434.0 L 454.9,435.4 L 451.2,436.9 L 447.6,438.4 L 443.9,439.9 L 440.3,441.4 L 436.7,443.0 L 433.0,444.6 L 429.4,446.2 L 425.9,447.9 L 422.3,449.6 L 418.7,451.4 L 415.2,453.1 L 411.6,454.9 L 408.1,456.8 L 404.6,458.6 L 401.1,460.5 L 397.6,462.4 L 394.2,464.4 L 390.7,466.4 L 387.3,468.4 L 383.9,470.5 L 380.5,472.5 L 377.1,474.7 L 373.8,476.8 L 370.4,479.0 L 367.1,481.2 L 363.8,483.4 L 360.5,485.7 L 357.2,488.0 L 354.0,490.3 L 350.7,492.7 L 347.5,495.0 L 344.3,497.4 L 341.1,499.9 L 338.0,502.4 L 334.8,504.9 L 331.7,507.4 L 328.6,509.9 L 325.5,512.5 L 322.5,515.1 L 319.5,517.8 L 316.4,520.4 L 313.5,523.1 L 310.5,525.9 L 307.5,528.6 L 304.6,531.4 L 301.7,534.2 L 298.9,537.0 L 296.0,539.9 L 293.2,542.8 L 642.0,846.0 Z" fill="var(--fan-cone)" />
        <g strokeLinecap="butt">
<line className="fk1" x1="639.8" y1="836.3" x2="542.1" y2="413.4" strokeOpacity="0.38"/>
<line className="fk1" x1="639.7" y1="836.3" x2="539.8" y2="413.8" strokeOpacity="0.45"/>
<line className="fk1" x1="639.6" y1="836.3" x2="537.5" y2="414.2" strokeOpacity="0.43"/>
<line className="fk1" x1="639.6" y1="836.3" x2="535.2" y2="414.6" strokeOpacity="0.46"/>
<line className="fk0" x1="639.5" y1="836.3" x2="533.0" y2="415.0" strokeOpacity="0.36"/>
<line className="fk0" x1="639.5" y1="836.3" x2="530.7" y2="415.5" strokeOpacity="0.58"/>
<line className="fk0" x1="639.4" y1="836.3" x2="528.4" y2="415.9" strokeOpacity="0.51"/>
<line className="fk0" x1="639.4" y1="836.3" x2="526.1" y2="416.4" strokeOpacity="0.31"/>
<line className="fk0" x1="639.3" y1="836.4" x2="523.8" y2="416.9" strokeOpacity="0.37"/>
<line className="fk1" x1="639.3" y1="836.4" x2="521.5" y2="417.4" strokeOpacity="0.4"/>
<line className="fk1" x1="639.2" y1="836.4" x2="519.2" y2="417.9" strokeOpacity="0.37"/>
<line className="fk1" x1="639.2" y1="836.4" x2="517.0" y2="418.4" strokeOpacity="0.33"/>
<line className="fk0" x1="639.1" y1="836.4" x2="514.7" y2="419.0" strokeOpacity="0.56"/>
<line className="fk1" x1="639.1" y1="836.4" x2="512.4" y2="419.5" strokeOpacity="0.52"/>
<line className="fk1" x1="639.0" y1="836.4" x2="510.1" y2="420.1" strokeOpacity="0.31"/>
<line className="fk1" x1="639.0" y1="836.5" x2="507.9" y2="420.6" strokeOpacity="0.55"/>
<line className="fk0" x1="638.9" y1="836.5" x2="505.6" y2="421.2" strokeOpacity="0.46"/>
<line className="fk0" x1="638.9" y1="836.5" x2="503.3" y2="421.8" strokeOpacity="0.46"/>
<line className="fk0" x1="638.8" y1="836.5" x2="501.1" y2="422.4" strokeOpacity="0.37"/>
<line className="fk1" x1="638.8" y1="836.5" x2="498.8" y2="423.0" strokeOpacity="0.57"/>
<line className="fk1" x1="638.7" y1="836.5" x2="496.6" y2="423.6" strokeOpacity="0.48"/>
<line className="fk0" x1="638.7" y1="836.6" x2="494.3" y2="424.3" strokeOpacity="0.37"/>
<line className="fk0" x1="638.6" y1="836.6" x2="492.1" y2="424.9" strokeOpacity="0.57"/>
<line className="fk0" x1="638.6" y1="836.6" x2="489.8" y2="425.6" strokeOpacity="0.57"/>
<line className="fk0" x1="638.5" y1="836.6" x2="487.6" y2="426.3" strokeOpacity="0.52"/>
<line className="fk1" x1="638.5" y1="836.6" x2="485.3" y2="427.0" strokeOpacity="0.42"/>
<line className="fk1" x1="638.4" y1="836.7" x2="483.1" y2="427.7" strokeOpacity="0.55"/>
<line className="fk1" x1="638.4" y1="836.7" x2="480.8" y2="428.4" strokeOpacity="0.46"/>
<line className="fk0" x1="638.4" y1="836.7" x2="478.6" y2="429.1" strokeOpacity="0.36"/>
<line className="fk0" x1="638.3" y1="836.7" x2="476.4" y2="429.8" strokeOpacity="0.33"/>
<line className="fk1" x1="638.3" y1="836.7" x2="474.2" y2="430.6" strokeOpacity="0.57"/>
<line className="fk1" x1="638.2" y1="836.7" x2="471.9" y2="431.3" strokeOpacity="0.33"/>
<line className="fk1" x1="638.2" y1="836.8" x2="469.7" y2="432.1" strokeOpacity="0.45"/>
<line className="fk0" x1="638.1" y1="836.8" x2="467.5" y2="432.9" strokeOpacity="0.54"/>
<line className="fk1" x1="638.1" y1="836.8" x2="465.3" y2="433.7" strokeOpacity="0.33"/>
<line className="fk0" x1="638.0" y1="836.8" x2="463.1" y2="434.5" strokeOpacity="0.53"/>
<line className="fk1" x1="638.0" y1="836.9" x2="460.9" y2="435.3" strokeOpacity="0.34"/>
<line className="fk0" x1="637.9" y1="836.9" x2="458.7" y2="436.1" strokeOpacity="0.33"/>
<line className="fk0" x1="637.9" y1="836.9" x2="456.5" y2="437.0" strokeOpacity="0.55"/>
<line className="fk1" x1="637.8" y1="836.9" x2="454.3" y2="437.8" strokeOpacity="0.58"/>
<line className="fk0" x1="637.8" y1="836.9" x2="452.1" y2="438.7" strokeOpacity="0.47"/>
<line className="fk0" x1="637.7" y1="837.0" x2="449.9" y2="439.6" strokeOpacity="0.59"/>
<line className="fk1" x1="637.7" y1="837.0" x2="447.7" y2="440.5" strokeOpacity="0.32"/>
<line className="fk0" x1="637.6" y1="837.0" x2="445.5" y2="441.4" strokeOpacity="0.4"/>
<line className="fk1" x1="637.6" y1="837.0" x2="443.3" y2="442.3" strokeOpacity="0.43"/>
<line className="fk1" x1="637.5" y1="837.1" x2="441.2" y2="443.2" strokeOpacity="0.43"/>
<line className="fk1" x1="637.5" y1="837.1" x2="439.0" y2="444.1" strokeOpacity="0.3"/>
<line className="fk0" x1="637.4" y1="837.1" x2="436.8" y2="445.1" strokeOpacity="0.55"/>
<line className="fk0" x1="637.4" y1="837.1" x2="434.7" y2="446.1" strokeOpacity="0.42"/>
<line className="fk1" x1="637.4" y1="837.1" x2="432.5" y2="447.0" strokeOpacity="0.52"/>
<line className="fk1" x1="637.3" y1="837.2" x2="430.4" y2="448.0" strokeOpacity="0.58"/>
<line className="fk0" x1="637.3" y1="837.2" x2="428.2" y2="449.0" strokeOpacity="0.33"/>
<line className="fk0" x1="637.2" y1="837.2" x2="426.1" y2="450.0" strokeOpacity="0.4"/>
<line className="fk0" x1="637.2" y1="837.2" x2="424.0" y2="451.0" strokeOpacity="0.54"/>
<line className="fk1" x1="637.1" y1="837.3" x2="421.8" y2="452.1" strokeOpacity="0.47"/>
<line className="fk0" x1="637.1" y1="837.3" x2="419.7" y2="453.1" strokeOpacity="0.45"/>
<line className="fk1" x1="637.0" y1="837.3" x2="417.6" y2="454.2" strokeOpacity="0.54"/>
<line className="fk1" x1="637.0" y1="837.3" x2="415.5" y2="455.2" strokeOpacity="0.38"/>
<line className="fk0" x1="636.9" y1="837.4" x2="413.4" y2="456.3" strokeOpacity="0.52"/>
<line className="fk0" x1="636.9" y1="837.4" x2="411.3" y2="457.4" strokeOpacity="0.54"/>
<line className="fk1" x1="636.8" y1="837.4" x2="409.2" y2="458.5" strokeOpacity="0.34"/>
<line className="fk1" x1="636.8" y1="837.5" x2="407.1" y2="459.6" strokeOpacity="0.56"/>
<line className="fk1" x1="636.8" y1="837.5" x2="405.0" y2="460.7" strokeOpacity="0.53"/>
<line className="fk0" x1="636.7" y1="837.5" x2="402.9" y2="461.8" strokeOpacity="0.42"/>
<line className="fk0" x1="636.7" y1="837.5" x2="400.8" y2="463.0" strokeOpacity="0.32"/>
<line className="fk1" x1="636.6" y1="837.6" x2="398.7" y2="464.1" strokeOpacity="0.39"/>
<line className="fk0" x1="636.6" y1="837.6" x2="396.7" y2="465.3" strokeOpacity="0.3"/>
<line className="fk1" x1="636.5" y1="837.6" x2="394.6" y2="466.5" strokeOpacity="0.6"/>
<line className="fk0" x1="636.5" y1="837.7" x2="392.5" y2="467.7" strokeOpacity="0.37"/>
<line className="fk1" x1="636.5" y1="837.7" x2="390.5" y2="468.9" strokeOpacity="0.4"/>
<line className="fk1" x1="636.4" y1="837.7" x2="388.4" y2="470.1" strokeOpacity="0.47"/>
<line className="fk0" x1="636.4" y1="837.7" x2="386.4" y2="471.3" strokeOpacity="0.42"/>
<line className="fk1" x1="636.3" y1="837.8" x2="384.4" y2="472.5" strokeOpacity="0.49"/>
<line className="fk0" x1="636.3" y1="837.8" x2="382.3" y2="473.8" strokeOpacity="0.53"/>
<line className="fk0" x1="636.2" y1="837.8" x2="380.3" y2="475.0" strokeOpacity="0.33"/>
<line className="fk0" x1="636.2" y1="837.9" x2="378.3" y2="476.3" strokeOpacity="0.52"/>
<line className="fk1" x1="636.2" y1="837.9" x2="376.3" y2="477.6" strokeOpacity="0.43"/>
<line className="fk0" x1="636.1" y1="837.9" x2="374.3" y2="478.9" strokeOpacity="0.53"/>
<line className="fk1" x1="636.1" y1="838.0" x2="372.3" y2="480.2" strokeOpacity="0.3"/>
<line className="fk1" x1="636.0" y1="838.0" x2="370.3" y2="481.5" strokeOpacity="0.38"/>
<line className="fk1" x1="636.0" y1="838.0" x2="368.3" y2="482.8" strokeOpacity="0.47"/>
<line className="fk1" x1="635.9" y1="838.0" x2="366.3" y2="484.1" strokeOpacity="0.59"/>
<line className="fk0" x1="635.9" y1="838.1" x2="364.3" y2="485.5" strokeOpacity="0.49"/>
<line className="fk0" x1="635.9" y1="838.1" x2="362.4" y2="486.8" strokeOpacity="0.46"/>
<line className="fk0" x1="635.8" y1="838.1" x2="360.4" y2="488.2" strokeOpacity="0.42"/>
<line className="fk0" x1="635.8" y1="838.2" x2="358.5" y2="489.5" strokeOpacity="0.42"/>
<line className="fk0" x1="635.7" y1="838.2" x2="356.5" y2="490.9" strokeOpacity="0.56"/>
<line className="fk0" x1="635.7" y1="838.2" x2="354.6" y2="492.3" strokeOpacity="0.43"/>
<line className="fk1" x1="635.7" y1="838.3" x2="352.6" y2="493.7" strokeOpacity="0.43"/>
<line className="fk1" x1="635.6" y1="838.3" x2="350.7" y2="495.1" strokeOpacity="0.48"/>
<line className="fk1" x1="635.6" y1="838.3" x2="348.8" y2="496.6" strokeOpacity="0.46"/>
<line className="fk1" x1="635.5" y1="838.4" x2="346.9" y2="498.0" strokeOpacity="0.5"/>
<line className="fk1" x1="635.5" y1="838.4" x2="345.0" y2="499.5" strokeOpacity="0.5"/>
<line className="fk1" x1="635.5" y1="838.4" x2="343.1" y2="500.9" strokeOpacity="0.31"/>
<line className="fk0" x1="635.4" y1="838.5" x2="341.2" y2="502.4" strokeOpacity="0.48"/>
<line className="fk0" x1="635.4" y1="838.5" x2="339.3" y2="503.9" strokeOpacity="0.42"/>
<line className="fk1" x1="635.3" y1="838.5" x2="337.4" y2="505.3" strokeOpacity="0.32"/>
<line className="fk1" x1="635.3" y1="838.6" x2="335.6" y2="506.8" strokeOpacity="0.52"/>
<line className="fk0" x1="635.3" y1="838.6" x2="333.7" y2="508.4" strokeOpacity="0.47"/>
<line className="fk1" x1="635.2" y1="838.7" x2="331.8" y2="509.9" strokeOpacity="0.32"/>
<line className="fk0" x1="635.2" y1="838.7" x2="330.0" y2="511.4" strokeOpacity="0.43"/>
<line className="fk1" x1="635.1" y1="838.7" x2="328.1" y2="512.9" strokeOpacity="0.38"/>
<line className="fk0" x1="635.1" y1="838.8" x2="326.3" y2="514.5" strokeOpacity="0.31"/>
<line className="fk0" x1="635.1" y1="838.8" x2="324.5" y2="516.1" strokeOpacity="0.58"/>
<line className="fk1" x1="635.0" y1="838.8" x2="322.7" y2="517.6" strokeOpacity="0.34"/>
<line className="fk0" x1="635.0" y1="838.9" x2="320.9" y2="519.2" strokeOpacity="0.48"/>
<line className="fk0" x1="635.0" y1="838.9" x2="319.1" y2="520.8" strokeOpacity="0.32"/>
<line className="fk1" x1="634.9" y1="838.9" x2="317.3" y2="522.4" strokeOpacity="0.44"/>
<line className="fk0" x1="634.9" y1="839.0" x2="315.5" y2="524.0" strokeOpacity="0.56"/>
<line className="fk1" x1="634.8" y1="839.0" x2="313.7" y2="525.6" strokeOpacity="0.46"/>
<line className="fk0" x1="634.8" y1="839.1" x2="311.9" y2="527.3" strokeOpacity="0.41"/>
<line className="fk0" x1="634.8" y1="839.1" x2="310.2" y2="528.9" strokeOpacity="0.5"/>
<line className="fk1" x1="634.7" y1="839.1" x2="308.4" y2="530.5" strokeOpacity="0.48"/>
<line className="fk1" x1="634.7" y1="839.2" x2="306.7" y2="532.2" strokeOpacity="0.41"/>
<line className="fk0" x1="634.7" y1="839.2" x2="304.9" y2="533.9" strokeOpacity="0.59"/>
<line className="fk0" x1="634.6" y1="839.2" x2="303.2" y2="535.5" strokeOpacity="0.37"/>
<line className="fk0" x1="634.6" y1="839.3" x2="301.5" y2="537.2" strokeOpacity="0.45"/>
<line className="fk1" x1="634.6" y1="839.3" x2="299.8" y2="538.9" strokeOpacity="0.54"/>
<line className="fk1" x1="634.5" y1="839.4" x2="298.1" y2="540.6" strokeOpacity="0.38"/>
<line className="fk0" x1="634.5" y1="839.4" x2="296.4" y2="542.4" strokeOpacity="0.49"/>
<line className="fk0" x1="634.5" y1="839.4" x2="294.7" y2="544.1" strokeOpacity="0.36"/>
        </g>
        <g strokeLinecap="butt">
<line className="fo1" x1="645.7" y1="790.1" x2="692.4" y2="87.5" strokeOpacity="0.92"/>
<line className="fo1" x1="645.5" y1="790.1" x2="689.7" y2="87.8" strokeOpacity="0.98"/>
<line className="fo0" x1="645.3" y1="790.1" x2="687.0" y2="88.0" strokeOpacity="0.94"/>
<line className="fo0" x1="645.1" y1="790.1" x2="684.4" y2="88.3" strokeOpacity="0.88"/>
<line className="fo3" x1="644.9" y1="790.1" x2="681.7" y2="88.6" strokeOpacity="0.84"/>
<line className="fo0" x1="644.7" y1="790.1" x2="679.0" y2="88.9" strokeOpacity="0.86"/>
<line className="fo4" x1="644.5" y1="790.1" x2="676.4" y2="89.2" strokeOpacity="0.88"/>
<line className="fo0" x1="644.3" y1="790.0" x2="673.7" y2="89.5" strokeOpacity="0.99"/>
<line className="fo1" x1="644.1" y1="790.0" x2="671.0" y2="89.8" strokeOpacity="0.93"/>
<line className="fo2" x1="644.0" y1="790.0" x2="668.4" y2="90.2" strokeOpacity="0.92"/>
<line className="fo2" x1="643.8" y1="790.0" x2="665.7" y2="90.5" strokeOpacity="0.87"/>
<line className="fo2" x1="643.6" y1="790.0" x2="663.1" y2="90.9" strokeOpacity="0.92"/>
<line className="fo1" x1="643.4" y1="790.0" x2="660.4" y2="91.2" strokeOpacity="0.97"/>
<line className="fo0" x1="643.2" y1="790.0" x2="657.8" y2="91.6" strokeOpacity="0.97"/>
<line className="fo3" x1="643.0" y1="790.0" x2="655.2" y2="92.0" strokeOpacity="0.97"/>
<line className="fo4" x1="642.8" y1="790.0" x2="652.5" y2="92.4" strokeOpacity="0.97"/>
<line className="fo1" x1="642.6" y1="790.0" x2="649.9" y2="92.8" strokeOpacity="0.91"/>
<line className="fo2" x1="642.4" y1="790.0" x2="647.3" y2="93.2" strokeOpacity="0.9"/>
<line className="fo1" x1="642.2" y1="790.0" x2="644.6" y2="93.6" strokeOpacity="0.9"/>
<line className="fo4" x1="642.0" y1="790.0" x2="642.0" y2="94.0" strokeOpacity="0.89"/>
<line className="fo4" x1="641.8" y1="790.0" x2="639.4" y2="94.4" strokeOpacity="0.96"/>
<line className="fo1" x1="641.6" y1="790.0" x2="636.8" y2="94.9" strokeOpacity="0.91"/>
<line className="fo2" x1="641.4" y1="790.0" x2="634.1" y2="95.3" strokeOpacity="0.93"/>
<line className="fo3" x1="641.2" y1="790.0" x2="631.5" y2="95.8" strokeOpacity="0.98"/>
<line className="fo0" x1="641.0" y1="790.0" x2="628.9" y2="96.3" strokeOpacity="0.93"/>
<line className="fo3" x1="640.8" y1="790.0" x2="626.3" y2="96.7" strokeOpacity="0.93"/>
<line className="fo3" x1="640.6" y1="790.0" x2="623.7" y2="97.2" strokeOpacity="0.97"/>
<line className="fo3" x1="640.4" y1="790.0" x2="621.1" y2="97.7" strokeOpacity="0.89"/>
<line className="fo0" x1="640.2" y1="790.0" x2="618.5" y2="98.2" strokeOpacity="0.85"/>
<line className="fo1" x1="640.0" y1="790.0" x2="615.9" y2="98.8" strokeOpacity="0.99"/>
<line className="fo4" x1="639.9" y1="790.0" x2="613.3" y2="99.3" strokeOpacity="0.85"/>
<line className="fo2" x1="639.7" y1="790.0" x2="610.7" y2="99.8" strokeOpacity="0.92"/>
<line className="fo2" x1="639.5" y1="790.1" x2="608.1" y2="100.4" strokeOpacity="0.89"/>
<line className="fo1" x1="639.3" y1="790.1" x2="605.6" y2="100.9" strokeOpacity="0.88"/>
<line className="fo2" x1="639.1" y1="790.1" x2="603.0" y2="101.5" strokeOpacity="0.9"/>
<line className="fo0" x1="638.9" y1="790.1" x2="600.4" y2="102.0" strokeOpacity="0.89"/>
<line className="fo3" x1="638.7" y1="790.1" x2="597.8" y2="102.6" strokeOpacity="0.93"/>
<line className="fo2" x1="638.5" y1="790.1" x2="595.3" y2="103.2" strokeOpacity="0.91"/>
<line className="fo2" x1="638.3" y1="790.1" x2="592.7" y2="103.8" strokeOpacity="0.91"/>
<line className="fo1" x1="638.1" y1="790.1" x2="590.1" y2="104.4" strokeOpacity="0.9"/>
<line className="fo4" x1="637.9" y1="790.2" x2="587.6" y2="105.0" strokeOpacity="0.88"/>
<line className="fo2" x1="637.7" y1="790.2" x2="585.0" y2="105.6" strokeOpacity="0.97"/>
<line className="fo0" x1="637.5" y1="790.2" x2="582.5" y2="106.3" strokeOpacity="0.9"/>
<line className="fo3" x1="637.3" y1="790.2" x2="579.9" y2="106.9" strokeOpacity="0.93"/>
<line className="fo1" x1="637.1" y1="790.2" x2="577.4" y2="107.6" strokeOpacity="0.96"/>
<line className="fo2" x1="636.9" y1="790.2" x2="574.9" y2="108.2" strokeOpacity="0.97"/>
<line className="fo4" x1="636.7" y1="790.2" x2="572.3" y2="108.9" strokeOpacity="0.86"/>
<line className="fo4" x1="636.5" y1="790.3" x2="569.8" y2="109.6" strokeOpacity="0.93"/>
<line className="fo1" x1="636.3" y1="790.3" x2="567.3" y2="110.3" strokeOpacity="0.85"/>
<line className="fo3" x1="636.1" y1="790.3" x2="564.7" y2="110.9" strokeOpacity="0.98"/>
<line className="fo2" x1="636.0" y1="790.3" x2="562.2" y2="111.7" strokeOpacity="0.97"/>
<line className="fo1" x1="635.8" y1="790.3" x2="559.7" y2="112.4" strokeOpacity="0.92"/>
<line className="fo4" x1="635.6" y1="790.4" x2="557.2" y2="113.1" strokeOpacity="0.87"/>
<line className="fo2" x1="635.4" y1="790.4" x2="554.7" y2="113.8" strokeOpacity="0.99"/>
<line className="fo3" x1="635.2" y1="790.4" x2="552.2" y2="114.5" strokeOpacity="0.85"/>
<line className="fo4" x1="635.0" y1="790.4" x2="549.7" y2="115.3" strokeOpacity="0.89"/>
<line className="fo4" x1="634.8" y1="790.5" x2="547.2" y2="116.0" strokeOpacity="0.85"/>
<line className="fo0" x1="634.6" y1="790.5" x2="544.7" y2="116.8" strokeOpacity="0.88"/>
<line className="fo0" x1="634.4" y1="790.5" x2="542.2" y2="117.6" strokeOpacity="0.98"/>
<line className="fo0" x1="634.2" y1="790.5" x2="539.7" y2="118.4" strokeOpacity="0.84"/>
<line className="fo1" x1="634.0" y1="790.6" x2="537.3" y2="119.1" strokeOpacity="0.86"/>
<line className="fo3" x1="633.8" y1="790.6" x2="534.8" y2="119.9" strokeOpacity="0.88"/>
<line className="fo1" x1="633.6" y1="790.6" x2="532.3" y2="120.7" strokeOpacity="0.92"/>
<line className="fo4" x1="633.4" y1="790.7" x2="529.8" y2="121.5" strokeOpacity="0.89"/>
<line className="fo3" x1="633.2" y1="790.7" x2="527.4" y2="122.4" strokeOpacity="0.9"/>
<line className="fo2" x1="633.0" y1="790.7" x2="524.9" y2="123.2" strokeOpacity="0.97"/>
<line className="fo2" x1="632.9" y1="790.8" x2="522.5" y2="124.0" strokeOpacity="0.95"/>
<line className="fo3" x1="632.7" y1="790.8" x2="520.0" y2="124.9" strokeOpacity="0.92"/>
<line className="fo0" x1="632.5" y1="790.8" x2="517.6" y2="125.7" strokeOpacity="0.95"/>
<line className="fo0" x1="632.3" y1="790.9" x2="515.2" y2="126.6" strokeOpacity="0.91"/>
<line className="fo2" x1="632.1" y1="790.9" x2="512.7" y2="127.5" strokeOpacity="0.98"/>
<line className="fo3" x1="631.9" y1="790.9" x2="510.3" y2="128.3" strokeOpacity="0.97"/>
<line className="fo3" x1="631.7" y1="791.0" x2="507.9" y2="129.2" strokeOpacity="0.99"/>
<line className="fo0" x1="631.5" y1="791.0" x2="505.4" y2="130.1" strokeOpacity="0.92"/>
<line className="fo0" x1="631.3" y1="791.0" x2="503.0" y2="131.0" strokeOpacity="0.97"/>
<line className="fo3" x1="631.1" y1="791.1" x2="500.6" y2="131.9" strokeOpacity="0.99"/>
<line className="fo1" x1="630.9" y1="791.1" x2="498.2" y2="132.9" strokeOpacity="0.88"/>
<line className="fo1" x1="630.7" y1="791.1" x2="495.8" y2="133.8" strokeOpacity="1.0"/>
<line className="fo3" x1="630.5" y1="791.2" x2="493.4" y2="134.7" strokeOpacity="0.95"/>
<line className="fo2" x1="630.4" y1="791.2" x2="491.0" y2="135.7" strokeOpacity="0.87"/>
<line className="fo3" x1="630.2" y1="791.3" x2="488.6" y2="136.6" strokeOpacity="0.92"/>
<line className="fo2" x1="630.0" y1="791.3" x2="486.2" y2="137.6" strokeOpacity="1.0"/>
<line className="fo0" x1="629.8" y1="791.3" x2="483.9" y2="138.5" strokeOpacity="0.92"/>
<line className="fo0" x1="629.6" y1="791.4" x2="481.5" y2="139.5" strokeOpacity="0.89"/>
<line className="fo1" x1="629.4" y1="791.4" x2="479.1" y2="140.5" strokeOpacity="0.96"/>
<line className="fo1" x1="535.0" y1="389.8" x2="476.8" y2="141.5" strokeOpacity="0.99"/>
<line className="fo3" x1="533.3" y1="389.6" x2="474.4" y2="142.5" strokeOpacity="0.84"/>
<line className="fo3" x1="531.5" y1="389.4" x2="472.0" y2="143.5" strokeOpacity="0.99"/>
<line className="fo0" x1="529.8" y1="389.3" x2="469.7" y2="144.5" strokeOpacity="0.89"/>
<line className="fo1" x1="528.1" y1="389.1" x2="467.4" y2="145.5" strokeOpacity="0.87"/>
<line className="fo1" x1="526.3" y1="388.9" x2="465.0" y2="146.6" strokeOpacity="0.93"/>
<line className="fo4" x1="524.6" y1="388.8" x2="462.7" y2="147.6" strokeOpacity="0.95"/>
<line className="fo4" x1="522.9" y1="388.6" x2="460.4" y2="148.7" strokeOpacity="0.92"/>
<line className="fo3" x1="521.1" y1="388.5" x2="458.0" y2="149.7" strokeOpacity="0.87"/>
<line className="fo2" x1="519.4" y1="388.3" x2="455.7" y2="150.8" strokeOpacity="0.9"/>
<line className="fo2" x1="517.6" y1="388.2" x2="453.4" y2="151.8" strokeOpacity="0.94"/>
<line className="fo4" x1="515.9" y1="388.1" x2="451.1" y2="152.9" strokeOpacity="0.92"/>
<line className="fo2" x1="514.1" y1="388.0" x2="448.8" y2="154.0" strokeOpacity="0.92"/>
<line className="fo3" x1="512.4" y1="387.9" x2="446.5" y2="155.1" strokeOpacity="0.99"/>
<line className="fo2" x1="510.6" y1="387.8" x2="444.2" y2="156.2" strokeOpacity="0.95"/>
<line className="fo0" x1="508.8" y1="387.7" x2="441.9" y2="157.3" strokeOpacity="0.92"/>
<line className="fo1" x1="507.1" y1="387.6" x2="439.6" y2="158.4" strokeOpacity="0.9"/>
<line className="fo1" x1="505.3" y1="387.5" x2="437.4" y2="159.5" strokeOpacity="0.99"/>
<line className="fo3" x1="503.5" y1="387.4" x2="435.1" y2="160.7" strokeOpacity="1.0"/>
<line className="fo4" x1="501.8" y1="387.4" x2="432.8" y2="161.8" strokeOpacity="0.96"/>
<line className="fo0" x1="500.0" y1="387.3" x2="430.6" y2="163.0" strokeOpacity="0.95"/>
<line className="fo1" x1="498.2" y1="387.2" x2="428.3" y2="164.1" strokeOpacity="0.98"/>
<line className="fo3" x1="496.5" y1="387.2" x2="426.1" y2="165.3" strokeOpacity="0.98"/>
<line className="fo3" x1="494.7" y1="387.1" x2="423.8" y2="166.4" strokeOpacity="0.97"/>
<line className="fo3" x1="492.9" y1="387.1" x2="421.6" y2="167.6" strokeOpacity="0.94"/>
<line className="fo1" x1="491.1" y1="387.1" x2="419.3" y2="168.8" strokeOpacity="0.91"/>
<line className="fo2" x1="489.3" y1="387.1" x2="417.1" y2="170.0" strokeOpacity="0.86"/>
<line className="fo4" x1="487.5" y1="387.1" x2="414.9" y2="171.2" strokeOpacity="0.86"/>
<line className="fo4" x1="485.8" y1="387.0" x2="412.7" y2="172.4" strokeOpacity="0.88"/>
<line className="fo4" x1="484.0" y1="387.0" x2="410.5" y2="173.6" strokeOpacity="0.85"/>
<line className="fo4" x1="482.2" y1="387.1" x2="408.3" y2="174.8" strokeOpacity="0.96"/>
<line className="fo0" x1="480.4" y1="387.1" x2="406.1" y2="176.0" strokeOpacity="0.87"/>
<line className="fo1" x1="478.6" y1="387.1" x2="403.9" y2="177.3" strokeOpacity="0.97"/>
<line className="fo0" x1="476.8" y1="387.1" x2="401.7" y2="178.5" strokeOpacity="0.9"/>
<line className="fo4" x1="475.0" y1="387.1" x2="399.5" y2="179.8" strokeOpacity="0.95"/>
<line className="fo0" x1="473.2" y1="387.2" x2="397.3" y2="181.0" strokeOpacity="0.98"/>
<line className="fo3" x1="471.4" y1="387.2" x2="395.2" y2="182.3" strokeOpacity="0.85"/>
<line className="fo4" x1="469.6" y1="387.3" x2="393.0" y2="183.5" strokeOpacity="0.93"/>
<line className="fo4" x1="467.8" y1="387.4" x2="390.8" y2="184.8" strokeOpacity="0.89"/>
<line className="fo1" x1="466.0" y1="387.4" x2="388.7" y2="186.1" strokeOpacity="0.91"/>
<line className="fo0" x1="464.2" y1="387.5" x2="386.5" y2="187.4" strokeOpacity="0.97"/>
<line className="fo3" x1="462.3" y1="387.6" x2="384.4" y2="188.7" strokeOpacity="0.87"/>
<line className="fo4" x1="460.5" y1="387.7" x2="382.3" y2="190.0" strokeOpacity="0.91"/>
<line className="fo3" x1="458.7" y1="387.8" x2="380.1" y2="191.3" strokeOpacity="0.87"/>
<line className="fo2" x1="456.9" y1="387.9" x2="378.0" y2="192.6" strokeOpacity="0.89"/>
<line className="fo3" x1="455.1" y1="388.0" x2="375.9" y2="193.9" strokeOpacity="0.85"/>
<line className="fo2" x1="453.3" y1="388.1" x2="373.8" y2="195.3" strokeOpacity="1.0"/>
<line className="fo0" x1="451.5" y1="388.2" x2="371.7" y2="196.6" strokeOpacity="0.9"/>
<line className="fo1" x1="449.6" y1="388.4" x2="369.6" y2="197.9" strokeOpacity="0.86"/>
<line className="fo3" x1="447.8" y1="388.5" x2="367.5" y2="199.3" strokeOpacity="0.95"/>
<line className="fo0" x1="446.0" y1="388.7" x2="365.4" y2="200.7" strokeOpacity="0.94"/>
<line className="fo0" x1="444.2" y1="388.8" x2="363.3" y2="202.0" strokeOpacity="0.98"/>
<line className="fo3" x1="442.3" y1="389.0" x2="361.3" y2="203.4" strokeOpacity="0.88"/>
<line className="fo4" x1="440.5" y1="389.1" x2="359.2" y2="204.8" strokeOpacity="0.86"/>
<line className="fo0" x1="438.7" y1="389.3" x2="357.1" y2="206.2" strokeOpacity="0.98"/>
<line className="fo1" x1="436.8" y1="389.5" x2="355.1" y2="207.5" strokeOpacity="0.98"/>
<line className="fo1" x1="435.0" y1="389.7" x2="353.0" y2="208.9" strokeOpacity="0.89"/>
<line className="fo3" x1="433.2" y1="389.9" x2="351.0" y2="210.3" strokeOpacity="0.99"/>
<line className="fo2" x1="431.3" y1="390.1" x2="348.9" y2="211.8" strokeOpacity="0.99"/>
<line className="fo3" x1="429.5" y1="390.3" x2="346.9" y2="213.2" strokeOpacity="0.93"/>
<line className="fo0" x1="427.7" y1="390.5" x2="344.9" y2="214.6" strokeOpacity="0.88"/>
<line className="fo1" x1="425.8" y1="390.8" x2="342.9" y2="216.0" strokeOpacity="0.9"/>
<line className="fo0" x1="424.0" y1="391.0" x2="340.9" y2="217.5" strokeOpacity="0.89"/>
<line className="fo2" x1="422.2" y1="391.2" x2="338.8" y2="218.9" strokeOpacity="0.93"/>
<line className="fo2" x1="420.3" y1="391.5" x2="336.8" y2="220.3" strokeOpacity="0.91"/>
<line className="fo3" x1="418.5" y1="391.7" x2="334.9" y2="221.8" strokeOpacity="0.85"/>
<line className="fo1" x1="416.6" y1="392.0" x2="332.9" y2="223.3" strokeOpacity="0.94"/>
<line className="fo1" x1="414.8" y1="392.3" x2="330.9" y2="224.7" strokeOpacity="0.95"/>
<line className="fo1" x1="412.9" y1="392.5" x2="328.9" y2="226.2" strokeOpacity="0.87"/>
<line className="fo3" x1="411.1" y1="392.8" x2="327.0" y2="227.7" strokeOpacity="0.85"/>
<line className="fo3" x1="409.3" y1="393.1" x2="325.0" y2="229.2" strokeOpacity="0.93"/>
<line className="fo0" x1="407.4" y1="393.4" x2="323.0" y2="230.7" strokeOpacity="0.86"/>
<line className="fo0" x1="405.6" y1="393.7" x2="321.1" y2="232.2" strokeOpacity="0.87"/>
<line className="fo0" x1="403.7" y1="394.0" x2="319.2" y2="233.7" strokeOpacity="0.91"/>
<line className="fo0" x1="401.9" y1="394.4" x2="317.2" y2="235.2" strokeOpacity="0.89"/>
<line className="fo3" x1="400.0" y1="394.7" x2="315.3" y2="236.7" strokeOpacity="0.99"/>
<line className="fo1" x1="398.2" y1="395.0" x2="313.4" y2="238.2" strokeOpacity="0.94"/>
<line className="fo1" x1="396.3" y1="395.4" x2="311.5" y2="239.7" strokeOpacity="0.97"/>
<line className="fo3" x1="394.5" y1="395.7" x2="309.6" y2="241.3" strokeOpacity="0.92"/>
<line className="fo3" x1="392.6" y1="396.1" x2="307.7" y2="242.8" strokeOpacity="0.94"/>
<line className="fo3" x1="390.8" y1="396.5" x2="305.8" y2="244.4" strokeOpacity="0.94"/>
<line className="fo2" x1="388.9" y1="396.8" x2="303.9" y2="245.9" strokeOpacity="1.0"/>
<line className="fo1" x1="387.1" y1="397.2" x2="302.0" y2="247.5" strokeOpacity="0.95"/>
<line className="fo4" x1="385.2" y1="397.6" x2="300.1" y2="249.0" strokeOpacity="0.92"/>
<line className="fo2" x1="383.4" y1="398.0" x2="298.3" y2="250.6" strokeOpacity="0.89"/>
<line className="fo2" x1="381.5" y1="398.4" x2="296.4" y2="252.2" strokeOpacity="0.89"/>
<line className="fo3" x1="379.6" y1="398.8" x2="294.5" y2="253.8" strokeOpacity="0.86"/>
<line className="fo3" x1="377.8" y1="399.2" x2="292.7" y2="255.4" strokeOpacity="0.87"/>
<line className="fo2" x1="375.9" y1="399.7" x2="290.9" y2="256.9" strokeOpacity="0.97"/>
<line className="fo0" x1="374.1" y1="400.1" x2="289.0" y2="258.5" strokeOpacity="0.94"/>
<line className="fo1" x1="372.2" y1="400.5" x2="287.2" y2="260.1" strokeOpacity="0.88"/>
<line className="fo4" x1="370.4" y1="401.0" x2="285.4" y2="261.8" strokeOpacity="0.98"/>
<line className="fo4" x1="368.5" y1="401.4" x2="283.6" y2="263.4" strokeOpacity="0.88"/>
<line className="fo4" x1="366.7" y1="401.9" x2="281.8" y2="265.0" strokeOpacity="0.92"/>
<line className="fo1" x1="364.8" y1="402.4" x2="280.0" y2="266.6" strokeOpacity="0.93"/>
<line className="fo1" x1="362.9" y1="402.9" x2="278.2" y2="268.2" strokeOpacity="1.0"/>
<line className="fo4" x1="361.1" y1="403.4" x2="276.4" y2="269.9" strokeOpacity="1.0"/>
<line className="fo1" x1="359.2" y1="403.8" x2="274.6" y2="271.5" strokeOpacity="0.93"/>
<line className="fo0" x1="357.4" y1="404.3" x2="272.8" y2="273.2" strokeOpacity="0.94"/>
<line className="fo1" x1="355.5" y1="404.9" x2="271.1" y2="274.8" strokeOpacity="0.96"/>
<line className="fo1" x1="353.7" y1="405.4" x2="269.3" y2="276.5" strokeOpacity="0.88"/>
<line className="fo4" x1="351.8" y1="405.9" x2="267.6" y2="278.1" strokeOpacity="0.91"/>
<line className="fo2" x1="350.0" y1="406.4" x2="265.8" y2="279.8" strokeOpacity="0.89"/>
<line className="fo2" x1="348.1" y1="407.0" x2="264.1" y2="281.5" strokeOpacity="0.88"/>
<line className="fo0" x1="346.2" y1="407.5" x2="262.4" y2="283.2" strokeOpacity="0.91"/>
<line className="fo1" x1="344.4" y1="408.1" x2="260.6" y2="284.9" strokeOpacity="0.88"/>
<line className="fo4" x1="342.5" y1="408.6" x2="258.9" y2="286.5" strokeOpacity="0.93"/>
<line className="fo4" x1="340.7" y1="409.2" x2="257.2" y2="288.2" strokeOpacity="0.85"/>
<line className="fo2" x1="338.8" y1="409.8" x2="255.5" y2="289.9" strokeOpacity="0.87"/>
<line className="fo2" x1="337.0" y1="410.4" x2="253.8" y2="291.6" strokeOpacity="0.94"/>
<line className="fo0" x1="335.1" y1="411.0" x2="252.1" y2="293.3" strokeOpacity="0.99"/>
<line className="fo0" x1="333.3" y1="411.6" x2="250.5" y2="295.1" strokeOpacity="0.89"/>
<line className="fo2" x1="331.4" y1="412.2" x2="248.8" y2="296.8" strokeOpacity="0.88"/>
<line className="fo4" x1="329.6" y1="412.8" x2="247.1" y2="298.5" strokeOpacity="0.9"/>
<line className="fo1" x1="327.7" y1="413.4" x2="245.5" y2="300.2" strokeOpacity="0.87"/>
<line className="fo4" x1="325.9" y1="414.1" x2="243.8" y2="302.0" strokeOpacity="0.97"/>
<line className="fo3" x1="324.0" y1="414.7" x2="242.2" y2="303.7" strokeOpacity="0.85"/>
<line className="fo1" x1="322.2" y1="415.3" x2="240.6" y2="305.5" strokeOpacity="0.97"/>
<line className="fo1" x1="320.3" y1="416.0" x2="238.9" y2="307.2" strokeOpacity="0.89"/>
<line className="fo3" x1="318.5" y1="416.7" x2="237.3" y2="309.0" strokeOpacity="0.94"/>
<line className="fo0" x1="316.6" y1="417.3" x2="235.7" y2="310.7" strokeOpacity="0.87"/>
<line className="fo3" x1="314.8" y1="418.0" x2="234.1" y2="312.5" strokeOpacity="0.91"/>
<line className="fo1" x1="312.9" y1="418.7" x2="232.5" y2="314.2" strokeOpacity="0.92"/>
<line className="fo0" x1="311.1" y1="419.4" x2="230.9" y2="316.0" strokeOpacity="0.93"/>
<line className="fo1" x1="309.2" y1="420.1" x2="229.3" y2="317.8" strokeOpacity="0.89"/>
<line className="fo1" x1="307.4" y1="420.8" x2="227.7" y2="319.6" strokeOpacity="0.88"/>
<line className="fo4" x1="305.5" y1="421.5" x2="226.2" y2="321.4" strokeOpacity="0.99"/>
<line className="fo0" x1="303.7" y1="422.2" x2="224.6" y2="323.2" strokeOpacity="0.94"/>
<line className="fo0" x1="301.9" y1="423.0" x2="223.1" y2="325.0" strokeOpacity="0.96"/>
<line className="fo1" x1="300.0" y1="423.7" x2="221.5" y2="326.7" strokeOpacity="0.9"/>
<line className="fo3" x1="298.2" y1="424.4" x2="220.0" y2="328.6" strokeOpacity="0.94"/>
<line className="fo3" x1="296.4" y1="425.2" x2="218.5" y2="330.4" strokeOpacity="0.9"/>
<line className="fo4" x1="294.5" y1="426.0" x2="216.9" y2="332.2" strokeOpacity="0.99"/>
<line className="fo4" x1="292.7" y1="426.7" x2="215.4" y2="334.0" strokeOpacity="0.96"/>
<line className="fo2" x1="290.8" y1="427.5" x2="213.9" y2="335.8" strokeOpacity="0.92"/>
<line className="fo3" x1="289.0" y1="428.3" x2="212.4" y2="337.6" strokeOpacity="0.97"/>
<line className="fo3" x1="287.2" y1="429.1" x2="210.9" y2="339.5" strokeOpacity="0.97"/>
<line className="fo0" x1="285.3" y1="429.9" x2="209.4" y2="341.3" strokeOpacity="0.93"/>
<line className="fo4" x1="283.5" y1="430.7" x2="207.9" y2="343.1" strokeOpacity="0.89"/>
<line className="fo4" x1="281.7" y1="431.5" x2="206.5" y2="345.0" strokeOpacity="0.91"/>
<line className="fo0" x1="279.9" y1="432.3" x2="205.0" y2="346.8" strokeOpacity="0.89"/>
<line className="fo0" x1="278.0" y1="433.2" x2="203.6" y2="348.7" strokeOpacity="0.89"/>
<line className="fo4" x1="276.2" y1="434.0" x2="202.1" y2="350.5" strokeOpacity="0.98"/>
<line className="fo3" x1="274.4" y1="434.9" x2="200.7" y2="352.4" strokeOpacity="0.94"/>
<line className="fo2" x1="272.6" y1="435.7" x2="199.2" y2="354.3" strokeOpacity="0.98"/>
<line className="fo0" x1="270.8" y1="436.6" x2="197.8" y2="356.1" strokeOpacity="0.88"/>
<line className="fo3" x1="268.9" y1="437.4" x2="196.4" y2="358.0" strokeOpacity="0.88"/>
<line className="fo3" x1="267.1" y1="438.3" x2="195.0" y2="359.9" strokeOpacity="1.0"/>
<line className="fo3" x1="265.3" y1="439.2" x2="193.6" y2="361.8" strokeOpacity="0.95"/>
<line className="fo4" x1="263.5" y1="440.1" x2="192.2" y2="363.6" strokeOpacity="0.99"/>
<line className="fo4" x1="261.7" y1="441.0" x2="190.8" y2="365.5" strokeOpacity="0.89"/>
<line className="fo3" x1="259.9" y1="441.9" x2="189.4" y2="367.4" strokeOpacity="0.99"/>
<line className="fo0" x1="258.1" y1="442.8" x2="188.1" y2="369.3" strokeOpacity="1.0"/>
<line className="fo2" x1="256.3" y1="443.7" x2="186.7" y2="371.2" strokeOpacity="0.98"/>
<line className="fo3" x1="254.5" y1="444.7" x2="185.3" y2="373.1" strokeOpacity="0.93"/>
<line className="fo1" x1="252.6" y1="445.6" x2="184.0" y2="375.0" strokeOpacity="0.88"/>
<line className="fo3" x1="250.8" y1="446.6" x2="182.6" y2="376.9" strokeOpacity="0.93"/>
<line className="fo0" x1="249.0" y1="447.5" x2="181.3" y2="378.8" strokeOpacity="0.86"/>
<line className="fo1" x1="247.2" y1="448.5" x2="180.0" y2="380.7" strokeOpacity="0.86"/>
<line className="fo4" x1="245.5" y1="449.5" x2="178.7" y2="382.7" strokeOpacity="0.93"/>
<line className="fo3" x1="243.7" y1="450.4" x2="177.4" y2="384.6" strokeOpacity="0.84"/>
<line className="fo1" x1="241.9" y1="451.4" x2="176.1" y2="386.5" strokeOpacity="0.96"/>
<line className="fo0" x1="240.1" y1="452.4" x2="174.8" y2="388.4" strokeOpacity="0.89"/>
<line className="fo0" x1="238.3" y1="453.4" x2="173.5" y2="390.4" strokeOpacity="0.91"/>
<line className="fo3" x1="236.5" y1="454.4" x2="172.2" y2="392.3" strokeOpacity="0.97"/>
<line className="fo3" x1="234.7" y1="455.4" x2="170.9" y2="394.3" strokeOpacity="0.86"/>
<line className="fo4" x1="232.9" y1="456.5" x2="169.7" y2="396.2" strokeOpacity="0.88"/>
<line className="fo2" x1="231.2" y1="457.5" x2="168.4" y2="398.1" strokeOpacity="0.84"/>
<line className="fo2" x1="229.4" y1="458.5" x2="167.2" y2="400.1" strokeOpacity="0.89"/>
<line className="fo3" x1="227.6" y1="459.6" x2="165.9" y2="402.1" strokeOpacity="0.86"/>
<line className="fo3" x1="225.8" y1="460.6" x2="164.7" y2="404.0" strokeOpacity="0.98"/>
<line className="fo1" x1="224.1" y1="461.7" x2="163.5" y2="406.0" strokeOpacity="0.89"/>
<line className="fo0" x1="222.3" y1="462.8" x2="162.3" y2="407.9" strokeOpacity="0.87"/>
<line className="fo2" x1="220.5" y1="463.8" x2="161.0" y2="409.9" strokeOpacity="0.98"/>
<line className="fo0" x1="605.7" y1="814.6" x2="285.9" y2="538.7" strokeOpacity="0.87"/>
<line className="fo4" x1="605.6" y1="814.8" x2="284.6" y2="539.7" strokeOpacity="0.87"/>
<line className="fo1" x1="605.4" y1="814.9" x2="283.2" y2="540.7" strokeOpacity="0.87"/>
<line className="fo0" x1="605.3" y1="815.0" x2="281.9" y2="541.7" strokeOpacity="0.94"/>
<line className="fo2" x1="605.2" y1="815.1" x2="280.5" y2="542.7" strokeOpacity="0.96"/>
<line className="fo2" x1="605.1" y1="815.3" x2="279.2" y2="543.7" strokeOpacity="0.99"/>
<line className="fo2" x1="605.0" y1="815.4" x2="277.9" y2="544.8" strokeOpacity="0.98"/>
<line className="fo1" x1="604.9" y1="815.5" x2="276.5" y2="545.8" strokeOpacity="0.89"/>
<line className="fo3" x1="604.8" y1="815.7" x2="275.2" y2="546.8" strokeOpacity="0.91"/>
<line className="fo1" x1="604.7" y1="815.8" x2="273.9" y2="547.9" strokeOpacity="0.88"/>
<line className="fo2" x1="604.6" y1="815.9" x2="272.5" y2="548.9" strokeOpacity="0.86"/>
<line className="fo1" x1="604.5" y1="816.1" x2="271.2" y2="550.0" strokeOpacity="0.88"/>
<line className="fo1" x1="604.4" y1="816.2" x2="269.9" y2="551.1" strokeOpacity="0.92"/>
<line className="fo2" x1="604.3" y1="816.3" x2="268.6" y2="552.1" strokeOpacity="0.97"/>
<line className="fo2" x1="604.2" y1="816.4" x2="267.3" y2="553.2" strokeOpacity="0.97"/>
<line className="fo4" x1="604.1" y1="816.6" x2="265.9" y2="554.3" strokeOpacity="0.98"/>
<line className="fo4" x1="604.0" y1="816.7" x2="264.6" y2="555.4" strokeOpacity="0.92"/>
<line className="fo2" x1="603.9" y1="816.8" x2="263.3" y2="556.5" strokeOpacity="0.98"/>
<line className="fo1" x1="603.8" y1="817.0" x2="262.0" y2="557.6" strokeOpacity="0.95"/>
<line className="fo2" x1="603.7" y1="817.1" x2="260.7" y2="558.7" strokeOpacity="0.86"/>
<line className="fo0" x1="603.6" y1="817.2" x2="259.4" y2="559.8" strokeOpacity="0.91"/>
<line className="fo0" x1="603.5" y1="817.4" x2="258.1" y2="560.9" strokeOpacity="0.91"/>
<line className="fo4" x1="603.4" y1="817.5" x2="256.9" y2="562.0" strokeOpacity="0.85"/>
<line className="fo0" x1="603.3" y1="817.7" x2="255.6" y2="563.2" strokeOpacity="0.84"/>
<line className="fo4" x1="603.2" y1="817.8" x2="254.3" y2="564.3" strokeOpacity="0.89"/>
<line className="fo2" x1="603.1" y1="817.9" x2="253.0" y2="565.4" strokeOpacity="0.91"/>
<line className="fo4" x1="603.0" y1="818.1" x2="251.7" y2="566.6" strokeOpacity="0.85"/>
<line className="fo2" x1="602.9" y1="818.2" x2="250.4" y2="567.7" strokeOpacity="1.0"/>
<line className="fo1" x1="602.8" y1="818.3" x2="249.2" y2="568.9" strokeOpacity="0.88"/>
<line className="fo2" x1="602.7" y1="818.5" x2="247.9" y2="570.1" strokeOpacity="0.96"/>
<line className="fo0" x1="602.6" y1="818.6" x2="246.6" y2="571.2" strokeOpacity="0.87"/>
<line className="fo1" x1="602.5" y1="818.7" x2="245.4" y2="572.4" strokeOpacity="1.0"/>
<line className="fo0" x1="602.4" y1="818.9" x2="244.1" y2="573.6" strokeOpacity="0.94"/>
<line className="fo4" x1="602.3" y1="819.0" x2="242.9" y2="574.7" strokeOpacity="0.9"/>
<line className="fo3" x1="602.2" y1="819.2" x2="241.6" y2="575.9" strokeOpacity="0.85"/>
<line className="fo0" x1="602.1" y1="819.3" x2="240.4" y2="577.1" strokeOpacity="0.93"/>
<line className="fo2" x1="602.0" y1="819.4" x2="239.1" y2="578.3" strokeOpacity="0.89"/>
<line className="fo3" x1="601.9" y1="819.6" x2="237.9" y2="579.5" strokeOpacity="0.97"/>
<line className="fo4" x1="601.8" y1="819.7" x2="236.6" y2="580.7" strokeOpacity="0.89"/>
<line className="fo4" x1="601.7" y1="819.9" x2="235.4" y2="582.0" strokeOpacity="0.96"/>
<line className="fo4" x1="601.7" y1="820.0" x2="234.2" y2="583.2" strokeOpacity="0.87"/>
<line className="fo1" x1="601.6" y1="820.1" x2="233.0" y2="584.4" strokeOpacity="0.86"/>
<line className="fo3" x1="601.5" y1="820.3" x2="231.7" y2="585.6" strokeOpacity="0.88"/>
<line className="fo3" x1="601.4" y1="820.4" x2="230.5" y2="586.9" strokeOpacity="0.93"/>
<line className="fo2" x1="601.3" y1="820.6" x2="229.3" y2="588.1" strokeOpacity="0.97"/>
<line className="fo1" x1="601.2" y1="820.7" x2="228.1" y2="589.4" strokeOpacity="0.88"/>
<line className="fo4" x1="601.1" y1="820.8" x2="226.9" y2="590.6" strokeOpacity="0.88"/>
<line className="fo4" x1="601.0" y1="821.0" x2="225.7" y2="591.9" strokeOpacity="0.94"/>
<line className="fo2" x1="600.9" y1="821.1" x2="224.5" y2="593.1" strokeOpacity="0.85"/>
<line className="fo4" x1="600.9" y1="821.3" x2="223.3" y2="594.4" strokeOpacity="1.0"/>
<line className="fo0" x1="600.8" y1="821.4" x2="222.1" y2="595.7" strokeOpacity="0.93"/>
<line className="fo1" x1="600.7" y1="821.6" x2="220.9" y2="597.0" strokeOpacity="0.89"/>
<line className="fo4" x1="600.6" y1="821.7" x2="219.7" y2="598.2" strokeOpacity="0.84"/>
<line className="fo3" x1="600.5" y1="821.9" x2="218.5" y2="599.5" strokeOpacity="0.97"/>
<line className="fo4" x1="600.4" y1="822.0" x2="217.3" y2="600.8" strokeOpacity="0.91"/>
<line className="fo2" x1="600.3" y1="822.1" x2="216.2" y2="602.1" strokeOpacity="0.98"/>
<line className="fo0" x1="600.3" y1="822.3" x2="215.0" y2="603.4" strokeOpacity="0.85"/>
<line className="fo1" x1="600.2" y1="822.4" x2="213.8" y2="604.7" strokeOpacity="0.93"/>
<line className="fo4" x1="600.1" y1="822.6" x2="212.7" y2="606.1" strokeOpacity="0.93"/>
<line className="fo1" x1="600.0" y1="822.7" x2="211.5" y2="607.4" strokeOpacity="0.94"/>
<line className="fo0" x1="599.9" y1="822.9" x2="210.4" y2="608.7" strokeOpacity="0.89"/>
<line className="fo0" x1="599.9" y1="823.0" x2="209.2" y2="610.0" strokeOpacity="0.95"/>
<line className="fo4" x1="599.8" y1="823.2" x2="208.1" y2="611.4" strokeOpacity="0.96"/>
<line className="fo2" x1="599.7" y1="823.3" x2="206.9" y2="612.7" strokeOpacity="0.96"/>
<line className="fo3" x1="599.6" y1="823.5" x2="205.8" y2="614.1" strokeOpacity="0.85"/>
<line className="fo4" x1="599.5" y1="823.6" x2="204.6" y2="615.4" strokeOpacity="0.87"/>
<line className="fo2" x1="599.5" y1="823.8" x2="203.5" y2="616.8" strokeOpacity="0.88"/>
<line className="fo3" x1="599.4" y1="823.9" x2="202.4" y2="618.1" strokeOpacity="0.95"/>
<line className="fo4" x1="599.3" y1="824.1" x2="201.3" y2="619.5" strokeOpacity="0.97"/>
<line className="fo0" x1="599.2" y1="824.2" x2="200.1" y2="620.9" strokeOpacity="0.89"/>
<line className="fo3" x1="599.2" y1="824.4" x2="199.0" y2="622.2" strokeOpacity="0.9"/>
<line className="fo1" x1="599.1" y1="824.5" x2="197.9" y2="623.6" strokeOpacity="0.95"/>
<line className="fo0" x1="599.0" y1="824.7" x2="196.8" y2="625.0" strokeOpacity="0.86"/>
<line className="fo4" x1="598.9" y1="824.8" x2="195.7" y2="626.4" strokeOpacity="1.0"/>
<line className="fo1" x1="598.9" y1="825.0" x2="194.6" y2="627.8" strokeOpacity="0.96"/>
<line className="fo4" x1="598.8" y1="825.1" x2="193.5" y2="629.2" strokeOpacity="0.96"/>
<line className="fo0" x1="598.7" y1="825.3" x2="192.4" y2="630.6" strokeOpacity="0.84"/>
<line className="fo3" x1="598.6" y1="825.4" x2="191.4" y2="632.0" strokeOpacity="0.98"/>
<line className="fo1" x1="598.6" y1="825.6" x2="190.3" y2="633.4" strokeOpacity="0.85"/>
<line className="fo4" x1="598.5" y1="825.7" x2="189.2" y2="634.9" strokeOpacity="0.89"/>
<line className="fo3" x1="598.4" y1="825.9" x2="188.1" y2="636.3" strokeOpacity="0.99"/>
<line className="fo0" x1="598.4" y1="826.0" x2="187.1" y2="637.7" strokeOpacity="0.95"/>
<line className="fo4" x1="598.3" y1="826.2" x2="186.0" y2="639.2" strokeOpacity="0.88"/>
<line className="fo2" x1="598.2" y1="826.3" x2="185.0" y2="640.6" strokeOpacity="0.86"/>
<line className="fo1" x1="598.1" y1="826.5" x2="183.9" y2="642.0" strokeOpacity="0.91"/>
<line className="fo0" x1="598.1" y1="826.6" x2="182.9" y2="643.5" strokeOpacity="0.99"/>
<line className="fo2" x1="598.0" y1="826.8" x2="181.8" y2="644.9" strokeOpacity="0.89"/>
<line className="fo4" x1="597.9" y1="826.9" x2="180.8" y2="646.4" strokeOpacity="0.87"/>
<line className="fo1" x1="597.9" y1="827.1" x2="179.7" y2="647.9" strokeOpacity="0.9"/>
<line className="fo0" x1="597.8" y1="827.2" x2="178.7" y2="649.3" strokeOpacity="0.96"/>
<line className="fo4" x1="597.8" y1="827.4" x2="177.7" y2="650.8" strokeOpacity="0.95"/>
<line className="fo4" x1="597.7" y1="827.6" x2="176.7" y2="652.3" strokeOpacity="0.99"/>
<line className="fo1" x1="597.6" y1="827.7" x2="175.6" y2="653.8" strokeOpacity="0.91"/>
<line className="fo3" x1="597.6" y1="827.9" x2="174.6" y2="655.3" strokeOpacity="0.99"/>
<line className="fo1" x1="597.5" y1="828.0" x2="173.6" y2="656.8" strokeOpacity="0.9"/>
<line className="fo0" x1="597.4" y1="828.2" x2="172.6" y2="658.3" strokeOpacity="0.87"/>
<line className="fo2" x1="597.4" y1="828.3" x2="171.6" y2="659.8" strokeOpacity="0.88"/>
<line className="fo4" x1="597.3" y1="828.5" x2="170.6" y2="661.3" strokeOpacity="0.97"/>
<line className="fo3" x1="597.2" y1="828.6" x2="169.7" y2="662.8" strokeOpacity="0.87"/>
<line className="fo1" x1="597.2" y1="828.8" x2="168.7" y2="664.3" strokeOpacity="0.94"/>
<line className="fo2" x1="597.1" y1="829.0" x2="167.7" y2="665.8" strokeOpacity="0.92"/>
<line className="fo3" x1="597.1" y1="829.1" x2="166.7" y2="667.4" strokeOpacity="1.0"/>
<line className="fo1" x1="597.0" y1="829.3" x2="165.8" y2="668.9" strokeOpacity="0.98"/>
<line className="fo1" x1="597.0" y1="829.4" x2="164.8" y2="670.4" strokeOpacity="0.93"/>
<line className="fo3" x1="596.9" y1="829.6" x2="163.8" y2="672.0" strokeOpacity="0.85"/>
<line className="fo2" x1="596.8" y1="829.7" x2="162.9" y2="673.5" strokeOpacity="0.9"/>
<line className="fo2" x1="596.8" y1="829.9" x2="161.9" y2="675.1" strokeOpacity="0.94"/>
<line className="fo4" x1="596.7" y1="830.1" x2="161.0" y2="676.6" strokeOpacity="0.87"/>
<line className="fo2" x1="596.7" y1="830.2" x2="160.1" y2="678.2" strokeOpacity="0.92"/>
<line className="fo4" x1="596.6" y1="830.4" x2="159.1" y2="679.7" strokeOpacity="0.99"/>
<line className="fo1" x1="596.6" y1="830.5" x2="158.2" y2="681.3" strokeOpacity="0.88"/>
<line className="fo2" x1="596.5" y1="830.7" x2="157.3" y2="682.9" strokeOpacity="0.85"/>
<line className="fo2" x1="596.5" y1="830.8" x2="156.4" y2="684.4" strokeOpacity="0.86"/>
<line className="fo1" x1="596.4" y1="831.0" x2="155.4" y2="686.0" strokeOpacity="0.96"/>
<line className="fo0" x1="596.3" y1="831.2" x2="154.5" y2="687.6" strokeOpacity="0.84"/>
<line className="fo2" x1="596.3" y1="831.3" x2="153.6" y2="689.2" strokeOpacity="0.97"/>
<line className="fo3" x1="596.2" y1="831.5" x2="152.7" y2="690.8" strokeOpacity="0.85"/>
<line className="fo3" x1="596.2" y1="831.6" x2="151.8" y2="692.4" strokeOpacity="0.89"/>
<line className="fo4" x1="596.1" y1="831.8" x2="151.0" y2="694.0" strokeOpacity="0.95"/>
<line className="fo2" x1="596.1" y1="832.0" x2="150.1" y2="695.6" strokeOpacity="0.9"/>
<line className="fo1" x1="596.0" y1="832.1" x2="149.2" y2="697.2" strokeOpacity="0.92"/>
<line className="fo1" x1="596.0" y1="832.3" x2="148.3" y2="698.8" strokeOpacity="0.86"/>
<line className="fo4" x1="596.0" y1="832.4" x2="147.5" y2="700.5" strokeOpacity="0.86"/>
<line className="fo1" x1="595.9" y1="832.6" x2="146.6" y2="702.1" strokeOpacity="0.89"/>
<line className="fo3" x1="595.9" y1="832.8" x2="145.7" y2="703.7" strokeOpacity="0.92"/>
<line className="fo1" x1="595.8" y1="832.9" x2="144.9" y2="705.3" strokeOpacity="0.92"/>
<line className="fo4" x1="595.8" y1="833.1" x2="144.1" y2="707.0" strokeOpacity="0.88"/>
<line className="fo3" x1="595.7" y1="833.3" x2="143.2" y2="708.6" strokeOpacity="0.95"/>
<line className="fo1" x1="595.7" y1="833.4" x2="142.4" y2="710.3" strokeOpacity="0.98"/>
<line className="fo2" x1="595.6" y1="833.6" x2="141.6" y2="711.9" strokeOpacity="0.93"/>
<line className="fo3" x1="595.6" y1="833.7" x2="140.7" y2="713.6" strokeOpacity="0.9"/>
<line className="fo3" x1="595.5" y1="833.9" x2="139.9" y2="715.2" strokeOpacity="0.92"/>
<line className="fo2" x1="595.5" y1="834.1" x2="139.1" y2="716.9" strokeOpacity="0.88"/>
<line className="fo2" x1="595.5" y1="834.2" x2="138.3" y2="718.5" strokeOpacity="0.9"/>
<line className="fo4" x1="595.4" y1="834.4" x2="137.5" y2="720.2" strokeOpacity="0.87"/>
<line className="fo0" x1="595.4" y1="834.6" x2="136.7" y2="721.9" strokeOpacity="0.98"/>
<line className="fo3" x1="595.3" y1="834.7" x2="135.9" y2="723.6" strokeOpacity="0.93"/>
<line className="fo2" x1="595.3" y1="834.9" x2="135.1" y2="725.2" strokeOpacity="0.95"/>
<line className="fo0" x1="595.3" y1="835.0" x2="134.3" y2="726.9" strokeOpacity="0.99"/>
<line className="fo1" x1="595.2" y1="835.2" x2="133.6" y2="728.6" strokeOpacity="0.93"/>
<line className="fo2" x1="595.2" y1="835.4" x2="132.8" y2="730.3" strokeOpacity="0.95"/>
<line className="fo2" x1="595.2" y1="835.5" x2="132.0" y2="732.0" strokeOpacity="0.88"/>
<line className="fo2" x1="595.1" y1="835.7" x2="131.3" y2="733.7" strokeOpacity="0.85"/>
<line className="fo3" x1="595.1" y1="835.9" x2="130.5" y2="735.4" strokeOpacity="0.86"/>
<line className="fo3" x1="595.0" y1="836.0" x2="129.8" y2="737.1" strokeOpacity="0.85"/>
<line className="fo3" x1="595.0" y1="836.2" x2="129.1" y2="738.8" strokeOpacity="0.99"/>
<line className="fo2" x1="595.0" y1="836.3" x2="128.3" y2="740.6" strokeOpacity="0.92"/>
<line className="fo2" x1="594.9" y1="836.5" x2="127.6" y2="742.3" strokeOpacity="0.88"/>
<line className="fo3" x1="594.9" y1="836.7" x2="126.9" y2="744.0" strokeOpacity="0.87"/>
<line className="fo1" x1="594.9" y1="836.8" x2="126.2" y2="745.7" strokeOpacity="0.9"/>
<line className="fo1" x1="594.9" y1="837.0" x2="125.4" y2="747.5" strokeOpacity="0.92"/>
<line className="fo2" x1="594.8" y1="837.2" x2="124.7" y2="749.2" strokeOpacity="0.99"/>
<line className="fo1" x1="594.8" y1="837.3" x2="124.0" y2="750.9" strokeOpacity="0.92"/>
<line className="fo2" x1="594.8" y1="837.5" x2="123.3" y2="752.7" strokeOpacity="0.95"/>
<line className="fo4" x1="594.7" y1="837.7" x2="122.7" y2="754.4" strokeOpacity="0.89"/>
<line className="fo0" x1="594.7" y1="837.8" x2="122.0" y2="756.2" strokeOpacity="0.98"/>
<line className="fo0" x1="594.7" y1="838.0" x2="121.3" y2="757.9" strokeOpacity="0.9"/>
<line className="fo0" x1="594.6" y1="838.2" x2="120.6" y2="759.7" strokeOpacity="0.99"/>
<line className="fo2" x1="594.6" y1="838.3" x2="120.0" y2="761.5" strokeOpacity="0.85"/>
<line className="fo3" x1="594.6" y1="838.5" x2="119.3" y2="763.2" strokeOpacity="0.98"/>
<line className="fo2" x1="594.6" y1="838.7" x2="118.7" y2="765.0" strokeOpacity="0.92"/>
<line className="fo2" x1="594.5" y1="838.8" x2="118.0" y2="766.8" strokeOpacity="0.98"/>
<line className="fo0" x1="594.5" y1="839.0" x2="117.4" y2="768.5" strokeOpacity="0.84"/>
<line className="fo2" x1="594.5" y1="839.2" x2="116.7" y2="770.3" strokeOpacity="0.89"/>
<line className="fo2" x1="594.5" y1="839.3" x2="116.1" y2="772.1" strokeOpacity="0.93"/>
<line className="fo2" x1="594.4" y1="839.5" x2="115.5" y2="773.9" strokeOpacity="0.97"/>
<line className="fo1" x1="594.4" y1="839.7" x2="114.9" y2="775.7" strokeOpacity="0.94"/>
<line className="fo3" x1="594.4" y1="839.8" x2="114.3" y2="777.5" strokeOpacity="0.94"/>
<line className="fo2" x1="594.4" y1="840.0" x2="113.7" y2="779.3" strokeOpacity="0.84"/>
<line className="fo1" x1="594.4" y1="840.2" x2="113.1" y2="781.1" strokeOpacity="0.96"/>
<line className="fo0" x1="594.3" y1="840.3" x2="112.5" y2="782.9" strokeOpacity="0.94"/>
<line className="fo3" x1="594.3" y1="840.5" x2="111.9" y2="784.7" strokeOpacity="0.94"/>
<line className="fo0" x1="594.3" y1="840.6" x2="111.3" y2="786.5" strokeOpacity="0.88"/>
<line className="fo3" x1="594.3" y1="840.8" x2="110.7" y2="788.3" strokeOpacity="0.98"/>
<line className="fo3" x1="594.3" y1="841.0" x2="110.2" y2="790.1" strokeOpacity="0.99"/>
<line className="fo3" x1="594.2" y1="841.1" x2="109.6" y2="791.9" strokeOpacity="0.85"/>
<line className="fo1" x1="594.2" y1="841.3" x2="109.1" y2="793.7" strokeOpacity="0.95"/>
<line className="fo2" x1="594.2" y1="841.5" x2="108.5" y2="795.6" strokeOpacity="0.89"/>
<line className="fo2" x1="594.2" y1="841.6" x2="108.0" y2="797.4" strokeOpacity="0.92"/>
<line className="fo0" x1="594.2" y1="841.8" x2="107.4" y2="799.2" strokeOpacity="0.86"/>
<line className="fo1" x1="594.2" y1="842.0" x2="106.9" y2="801.1" strokeOpacity="0.88"/>
<line className="fo2" x1="594.2" y1="842.2" x2="106.4" y2="802.9" strokeOpacity="0.95"/>
<line className="fo1" x1="594.1" y1="842.3" x2="105.9" y2="804.7" strokeOpacity="0.92"/>
<line className="fo4" x1="594.1" y1="842.5" x2="105.4" y2="806.6" strokeOpacity="1.0"/>
<line className="fo0" x1="594.1" y1="842.7" x2="104.9" y2="808.4" strokeOpacity="0.88"/>
<line className="fo3" x1="594.1" y1="842.8" x2="104.4" y2="810.3" strokeOpacity="0.98"/>
<line className="fo4" x1="594.1" y1="843.0" x2="103.9" y2="812.1" strokeOpacity="0.85"/>
<line className="fo4" x1="594.1" y1="843.2" x2="103.4" y2="814.0" strokeOpacity="0.98"/>
<line className="fo2" x1="594.1" y1="843.3" x2="102.9" y2="815.9" strokeOpacity="0.88"/>
<line className="fo0" x1="594.1" y1="843.5" x2="102.4" y2="817.7" strokeOpacity="0.98"/>
<line className="fo2" x1="594.1" y1="843.7" x2="102.0" y2="819.6" strokeOpacity="0.97"/>
<line className="fo1" x1="594.0" y1="843.8" x2="101.5" y2="821.5" strokeOpacity="0.95"/>
<line className="fo1" x1="594.0" y1="844.0" x2="101.1" y2="823.3" strokeOpacity="0.99"/>
<line className="fo1" x1="594.0" y1="844.2" x2="100.6" y2="825.2" strokeOpacity="0.87"/>
<line className="fo4" x1="594.0" y1="844.3" x2="100.2" y2="827.1" strokeOpacity="0.95"/>
<line className="fo4" x1="594.0" y1="844.5" x2="99.7" y2="829.0" strokeOpacity="0.89"/>
<line className="fo3" x1="594.0" y1="844.7" x2="99.3" y2="830.8" strokeOpacity="0.89"/>
<line className="fo4" x1="594.0" y1="844.8" x2="98.9" y2="832.7" strokeOpacity="0.92"/>
<line className="fo1" x1="594.0" y1="845.0" x2="98.5" y2="834.6" strokeOpacity="0.9"/>
<line className="fo1" x1="594.0" y1="845.2" x2="98.1" y2="836.5" strokeOpacity="0.99"/>
<line className="fo1" x1="594.0" y1="845.3" x2="97.7" y2="838.4" strokeOpacity="0.98"/>
<line className="fo0" x1="594.0" y1="845.5" x2="97.3" y2="840.3" strokeOpacity="0.97"/>
<line className="fo2" x1="594.0" y1="845.7" x2="96.9" y2="842.2" strokeOpacity="0.86"/>
<line className="fo3" x1="594.0" y1="845.8" x2="96.5" y2="844.1" strokeOpacity="0.92"/>
<line className="fo3" x1="594.0" y1="846.0" x2="96.1" y2="846.0" strokeOpacity="0.85"/>
<line className="fo4" x1="594.0" y1="846.2" x2="95.8" y2="847.9" strokeOpacity="0.98"/>
<line className="fo3" x1="594.0" y1="846.3" x2="95.4" y2="849.8" strokeOpacity="0.85"/>
<line className="fo2" x1="594.0" y1="846.5" x2="95.1" y2="851.7" strokeOpacity="0.9"/>
<line className="fo3" x1="594.0" y1="846.7" x2="94.7" y2="853.6" strokeOpacity="0.88"/>
<line className="fo2" x1="594.0" y1="846.8" x2="94.4" y2="855.6" strokeOpacity="0.9"/>
<line className="fo2" x1="594.0" y1="847.0" x2="94.1" y2="857.5" strokeOpacity="0.87"/>
<line className="fo1" x1="594.0" y1="847.2" x2="93.7" y2="859.4" strokeOpacity="0.97"/>
<line className="fo1" x1="594.0" y1="847.3" x2="93.4" y2="861.3" strokeOpacity="0.93"/>
<line className="fo3" x1="594.0" y1="847.5" x2="93.1" y2="863.3" strokeOpacity="0.94"/>
<line className="fo1" x1="594.0" y1="847.7" x2="92.8" y2="865.2" strokeOpacity="0.94"/>
<line className="fo2" x1="594.0" y1="847.8" x2="92.5" y2="867.1" strokeOpacity="0.97"/>
<line className="fo1" x1="594.0" y1="848.0" x2="92.2" y2="869.0" strokeOpacity="0.87"/>
<line className="fo4" x1="594.0" y1="848.2" x2="91.9" y2="871.0" strokeOpacity="0.95"/>
<line className="fo1" x1="594.1" y1="848.3" x2="91.6" y2="872.9" strokeOpacity="0.94"/>
<line className="fo0" x1="594.1" y1="848.5" x2="91.4" y2="874.9" strokeOpacity="0.92"/>
<line className="fo1" x1="594.1" y1="848.7" x2="91.1" y2="876.8" strokeOpacity="0.88"/>
<line className="fo2" x1="594.1" y1="848.8" x2="90.8" y2="878.7" strokeOpacity="0.91"/>
<line className="fo3" x1="594.1" y1="849.0" x2="90.6" y2="880.7" strokeOpacity="0.9"/>
        </g>
        <path d="M 536.7,390.0 L 532.4,389.5 L 528.1,389.1 L 523.7,388.7 L 519.4,388.3 L 515.0,388.0 L 510.6,387.8 L 506.2,387.5 L 501.8,387.4 L 497.3,387.2 L 492.9,387.1 L 488.4,387.1 L 484.0,387.0 L 479.5,387.1 L 475.0,387.1 L 470.5,387.3 L 466.0,387.4 L 461.4,387.6 L 456.9,387.9 L 452.4,388.2 L 447.8,388.5 L 443.2,388.9 L 438.7,389.3 L 434.1,389.8 L 429.5,390.3 L 424.9,390.9 L 420.3,391.5 L 415.7,392.1 L 411.1,392.8 L 406.5,393.6 L 401.9,394.4 L 397.2,395.2 L 392.6,396.1 L 388.0,397.0 L 383.4,398.0 L 378.7,399.0 L 374.1,400.1 L 369.4,401.2 L 364.8,402.4 L 360.2,403.6 L 355.5,404.9 L 350.9,406.2 L 346.2,407.5 L 341.6,408.9 L 337.0,410.4 L 332.3,411.9 L 327.7,413.4 L 323.1,415.0 L 318.5,416.7 L 313.8,418.3 L 309.2,420.1 L 304.6,421.9 L 300.0,423.7 L 295.4,425.6 L 290.8,427.5 L 286.3,429.5 L 281.7,431.5 L 277.1,433.6 L 272.6,435.7 L 268.0,437.9 L 263.5,440.1 L 259.0,442.4 L 254.5,444.7 L 249.9,447.0 L 245.5,449.5 L 241.0,451.9 L 236.5,454.4 L 232.1,457.0 L 227.6,459.6 L 223.2,462.2 L 218.8,464.9 L 298.9,537.0 L 301.7,534.2 L 304.6,531.4 L 307.5,528.6 L 310.5,525.9 L 313.5,523.1 L 316.4,520.4 L 319.5,517.8 L 322.5,515.1 L 325.5,512.5 L 328.6,509.9 L 331.7,507.4 L 334.8,504.9 L 338.0,502.4 L 341.1,499.9 L 344.3,497.4 L 347.5,495.0 L 350.7,492.7 L 354.0,490.3 L 357.2,488.0 L 360.5,485.7 L 363.8,483.4 L 367.1,481.2 L 370.4,479.0 L 373.8,476.8 L 377.1,474.7 L 380.5,472.5 L 383.9,470.5 L 387.3,468.4 L 390.7,466.4 L 394.2,464.4 L 397.6,462.4 L 401.1,460.5 L 404.6,458.6 L 408.1,456.8 L 411.6,454.9 L 415.2,453.1 L 418.7,451.4 L 422.3,449.6 L 425.9,447.9 L 429.4,446.2 L 433.0,444.6 L 436.7,443.0 L 440.3,441.4 L 443.9,439.9 L 447.6,438.4 L 451.2,436.9 L 454.9,435.4 L 458.6,434.0 L 462.3,432.7 L 466.0,431.3 L 469.7,430.0 L 473.4,428.7 L 477.1,427.5 L 480.9,426.3 L 484.6,425.1 L 488.4,423.9 L 492.1,422.8 L 495.9,421.7 L 499.7,420.7 L 503.5,419.7 L 507.3,418.7 L 511.1,417.8 L 514.9,416.9 L 518.7,416.0 L 522.5,415.1 L 526.3,414.3 L 530.2,413.6 L 534.0,412.8 L 537.8,412.1 L 541.7,411.4 Z" fill="var(--fan-curl)" />
        <g strokeLinecap="butt">
<line className="fcs" x1="541.7" y1="411.4" x2="539.4" y2="401.8" strokeOpacity="0.34"/>
<line className="fcs" x1="537.8" y1="412.1" x2="535.4" y2="401.9" strokeOpacity="0.23"/>
<line className="fcs" x1="534.0" y1="412.8" x2="531.3" y2="402.1" strokeOpacity="0.23"/>
<line className="fcs" x1="530.2" y1="413.6" x2="527.3" y2="402.4" strokeOpacity="0.4"/>
<line className="fcs" x1="526.3" y1="414.3" x2="523.2" y2="402.6" strokeOpacity="0.37"/>
<line className="fcs" x1="522.5" y1="415.1" x2="519.1" y2="402.9" strokeOpacity="0.24"/>
<line className="fcs" x1="518.7" y1="416.0" x2="515.1" y2="403.3" strokeOpacity="0.27"/>
<line className="fcs" x1="514.9" y1="416.9" x2="511.0" y2="403.7" strokeOpacity="0.31"/>
<line className="fcs" x1="511.1" y1="417.8" x2="506.9" y2="404.1" strokeOpacity="0.36"/>
<line className="fcs" x1="507.3" y1="418.7" x2="502.8" y2="404.5" strokeOpacity="0.28"/>
<line className="fcs" x1="503.5" y1="419.7" x2="498.7" y2="405.0" strokeOpacity="0.38"/>
<line className="fcs" x1="499.7" y1="420.7" x2="494.6" y2="405.6" strokeOpacity="0.37"/>
<line className="fcs" x1="495.9" y1="421.7" x2="490.5" y2="406.1" strokeOpacity="0.37"/>
<line className="fcs" x1="492.1" y1="422.8" x2="486.4" y2="406.7" strokeOpacity="0.23"/>
<line className="fcs" x1="488.4" y1="423.9" x2="482.4" y2="407.4" strokeOpacity="0.21"/>
<line className="fcs" x1="484.6" y1="425.1" x2="478.3" y2="408.1" strokeOpacity="0.29"/>
<line className="fcs" x1="480.9" y1="426.3" x2="474.2" y2="408.8" strokeOpacity="0.37"/>
<line className="fcs" x1="477.1" y1="427.5" x2="470.1" y2="409.5" strokeOpacity="0.33"/>
<line className="fcs" x1="473.4" y1="428.7" x2="466.0" y2="410.3" strokeOpacity="0.24"/>
<line className="fcs" x1="469.7" y1="430.0" x2="461.9" y2="411.2" strokeOpacity="0.34"/>
<line className="fcs" x1="466.0" y1="431.3" x2="457.8" y2="412.1" strokeOpacity="0.28"/>
<line className="fcs" x1="462.3" y1="432.7" x2="453.7" y2="413.0" strokeOpacity="0.23"/>
<line className="fcs" x1="458.6" y1="434.0" x2="449.6" y2="413.9" strokeOpacity="0.32"/>
<line className="fcs" x1="454.9" y1="435.4" x2="445.5" y2="414.9" strokeOpacity="0.33"/>
<line className="fcs" x1="451.2" y1="436.9" x2="441.5" y2="415.9" strokeOpacity="0.24"/>
<line className="fcs" x1="447.6" y1="438.4" x2="437.4" y2="417.0" strokeOpacity="0.26"/>
<line className="fcs" x1="443.9" y1="439.9" x2="433.3" y2="418.1" strokeOpacity="0.37"/>
<line className="fcs" x1="440.3" y1="441.4" x2="429.2" y2="419.2" strokeOpacity="0.29"/>
<line className="fcs" x1="436.7" y1="443.0" x2="425.2" y2="420.4" strokeOpacity="0.37"/>
<line className="fcs" x1="433.0" y1="444.6" x2="421.1" y2="421.6" strokeOpacity="0.31"/>
<line className="fcs" x1="429.4" y1="446.2" x2="417.0" y2="422.9" strokeOpacity="0.38"/>
<line className="fcs" x1="425.9" y1="447.9" x2="413.0" y2="424.2" strokeOpacity="0.38"/>
<line className="fcs" x1="422.3" y1="449.6" x2="408.9" y2="425.5" strokeOpacity="0.29"/>
<line className="fcs" x1="418.7" y1="451.4" x2="404.9" y2="426.9" strokeOpacity="0.23"/>
<line className="fcs" x1="415.2" y1="453.1" x2="400.9" y2="428.3" strokeOpacity="0.38"/>
<line className="fcs" x1="411.6" y1="454.9" x2="396.8" y2="429.8" strokeOpacity="0.25"/>
<line className="fcs" x1="408.1" y1="456.8" x2="392.8" y2="431.3" strokeOpacity="0.31"/>
<line className="fcs" x1="404.6" y1="458.6" x2="388.8" y2="432.8" strokeOpacity="0.25"/>
<line className="fcs" x1="401.1" y1="460.5" x2="384.8" y2="434.4" strokeOpacity="0.28"/>
<line className="fcs" x1="397.6" y1="462.4" x2="380.8" y2="436.0" strokeOpacity="0.26"/>
<line className="fcs" x1="394.2" y1="464.4" x2="376.8" y2="437.6" strokeOpacity="0.22"/>
<line className="fcs" x1="390.7" y1="466.4" x2="372.8" y2="439.3" strokeOpacity="0.24"/>
<line className="fcs" x1="387.3" y1="468.4" x2="368.8" y2="441.0" strokeOpacity="0.31"/>
<line className="fcs" x1="383.9" y1="470.5" x2="364.9" y2="442.8" strokeOpacity="0.31"/>
<line className="fcs" x1="380.5" y1="472.5" x2="360.9" y2="444.6" strokeOpacity="0.23"/>
<line className="fcs" x1="377.1" y1="474.7" x2="357.0" y2="446.4" strokeOpacity="0.2"/>
<line className="fcs" x1="373.8" y1="476.8" x2="353.0" y2="448.3" strokeOpacity="0.35"/>
<line className="fcs" x1="370.4" y1="479.0" x2="349.1" y2="450.2" strokeOpacity="0.33"/>
<line className="fcs" x1="367.1" y1="481.2" x2="345.2" y2="452.1" strokeOpacity="0.2"/>
<line className="fcs" x1="363.8" y1="483.4" x2="341.3" y2="454.1" strokeOpacity="0.27"/>
<line className="fcs" x1="360.5" y1="485.7" x2="337.4" y2="456.2" strokeOpacity="0.23"/>
<line className="fcs" x1="357.2" y1="488.0" x2="333.6" y2="458.2" strokeOpacity="0.36"/>
<line className="fcs" x1="354.0" y1="490.3" x2="329.7" y2="460.3" strokeOpacity="0.4"/>
<line className="fcs" x1="350.7" y1="492.7" x2="325.8" y2="462.5" strokeOpacity="0.28"/>
<line className="fcs" x1="347.5" y1="495.0" x2="322.0" y2="464.6" strokeOpacity="0.21"/>
<line className="fcs" x1="344.3" y1="497.4" x2="318.2" y2="466.9" strokeOpacity="0.27"/>
<line className="fcs" x1="341.1" y1="499.9" x2="314.4" y2="469.1" strokeOpacity="0.31"/>
<line className="fcs" x1="338.0" y1="502.4" x2="310.6" y2="471.4" strokeOpacity="0.31"/>
<line className="fcs" x1="334.8" y1="504.9" x2="306.8" y2="473.7" strokeOpacity="0.24"/>
<line className="fcs" x1="331.7" y1="507.4" x2="303.1" y2="476.1" strokeOpacity="0.32"/>
<line className="fcs" x1="328.6" y1="509.9" x2="299.3" y2="478.5" strokeOpacity="0.37"/>
<line className="fcs" x1="325.5" y1="512.5" x2="295.6" y2="481.0" strokeOpacity="0.25"/>
<line className="fcs" x1="322.5" y1="515.1" x2="291.9" y2="483.4" strokeOpacity="0.24"/>
<line className="fcs" x1="319.5" y1="517.8" x2="288.2" y2="485.9" strokeOpacity="0.26"/>
<line className="fcs" x1="316.4" y1="520.4" x2="284.5" y2="488.5" strokeOpacity="0.25"/>
<line className="fcs" x1="313.5" y1="523.1" x2="280.8" y2="491.1" strokeOpacity="0.36"/>
<line className="fcs" x1="310.5" y1="525.9" x2="277.2" y2="493.7" strokeOpacity="0.31"/>
<line className="fcs" x1="307.5" y1="528.6" x2="273.6" y2="496.4" strokeOpacity="0.39"/>
<line className="fcs" x1="304.6" y1="531.4" x2="270.0" y2="499.1" strokeOpacity="0.21"/>
<line className="fcs" x1="301.7" y1="534.2" x2="266.4" y2="501.8" strokeOpacity="0.37"/>
<line className="fcs" x1="298.9" y1="537.0" x2="262.8" y2="504.6" strokeOpacity="0.39"/>
        </g>
        <g><circle className="fgr" cx="370" cy="522" r="0.8" fillOpacity="0.18"/>
<circle className="fgr" cx="566" cy="256" r="0.8" fillOpacity="0.21"/>
<circle className="fgr" cx="535" cy="188" r="0.8" fillOpacity="0.14"/>
<circle className="fgr" cx="412" cy="759" r="0.6" fillOpacity="0.2"/>
<circle className="fgr" cx="343" cy="445" r="0.6" fillOpacity="0.21"/>
<circle className="fgr" cx="554" cy="165" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="268" cy="142" r="0.8" fillOpacity="0.17"/>
<circle className="fgr" cx="437" cy="260" r="0.6" fillOpacity="0.21"/>
<circle className="fgr" cx="393" cy="596" r="0.8" fillOpacity="0.21"/>
<circle className="fgr" cx="348" cy="516" r="0.6" fillOpacity="0.22"/>
<circle className="fgr" cx="303" cy="285" r="0.8" fillOpacity="0.12"/>
<circle className="fgr" cx="424" cy="197" r="0.6" fillOpacity="0.24"/>
<circle className="fgr" cx="338" cy="808" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="601" cy="158" r="0.8" fillOpacity="0.26"/>
<circle className="fgr" cx="343" cy="172" r="0.6" fillOpacity="0.23"/>
<circle className="fgr" cx="281" cy="183" r="0.8" fillOpacity="0.12"/>
<circle className="fgr" cx="349" cy="783" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="199" cy="163" r="0.8" fillOpacity="0.14"/>
<circle className="fgr" cx="422" cy="441" r="0.6" fillOpacity="0.26"/>
<circle className="fgr" cx="524" cy="421" r="0.8" fillOpacity="0.14"/>
<circle className="fgr" cx="354" cy="273" r="0.8" fillOpacity="0.24"/>
<circle className="fgr" cx="624" cy="546" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="342" cy="733" r="0.6" fillOpacity="0.13"/>
<circle className="fgr" cx="221" cy="437" r="0.6" fillOpacity="0.23"/>
<circle className="fgr" cx="310" cy="333" r="0.6" fillOpacity="0.13"/>
<circle className="fgr" cx="251" cy="577" r="0.6" fillOpacity="0.2"/>
<circle className="fgr" cx="331" cy="445" r="0.8" fillOpacity="0.24"/>
<circle className="fgr" cx="216" cy="397" r="0.6" fillOpacity="0.16"/>
<circle className="fgr" cx="261" cy="558" r="0.6" fillOpacity="0.14"/>
<circle className="fgr" cx="456" cy="518" r="0.8" fillOpacity="0.24"/>
<circle className="fgr" cx="443" cy="423" r="0.6" fillOpacity="0.14"/>
<circle className="fgr" cx="399" cy="303" r="0.8" fillOpacity="0.16"/>
<circle className="fgr" cx="550" cy="548" r="0.8" fillOpacity="0.19"/>
<circle className="fgr" cx="602" cy="822" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="422" cy="732" r="0.6" fillOpacity="0.16"/>
<circle className="fgr" cx="596" cy="266" r="0.6" fillOpacity="0.13"/>
<circle className="fgr" cx="350" cy="299" r="0.6" fillOpacity="0.14"/>
<circle className="fgr" cx="329" cy="531" r="0.6" fillOpacity="0.13"/>
<circle className="fgr" cx="217" cy="443" r="0.8" fillOpacity="0.21"/>
<circle className="fgr" cx="486" cy="540" r="0.6" fillOpacity="0.2"/>
<circle className="fgr" cx="599" cy="461" r="0.8" fillOpacity="0.22"/>
<circle className="fgr" cx="618" cy="135" r="0.6" fillOpacity="0.19"/>
<circle className="fgr" cx="505" cy="349" r="0.6" fillOpacity="0.13"/>
<circle className="fgr" cx="415" cy="649" r="0.6" fillOpacity="0.23"/>
<circle className="fgr" cx="595" cy="373" r="0.8" fillOpacity="0.25"/>
<circle className="fgr" cx="573" cy="420" r="0.6" fillOpacity="0.24"/>
<circle className="fgr" cx="428" cy="569" r="0.8" fillOpacity="0.17"/>
<circle className="fgr" cx="156" cy="172" r="0.6" fillOpacity="0.21"/>
<circle className="fgr" cx="633" cy="752" r="0.8" fillOpacity="0.17"/>
<circle className="fgr" cx="507" cy="537" r="0.8" fillOpacity="0.18"/>
<circle className="fgr" cx="413" cy="492" r="0.6" fillOpacity="0.16"/>
<circle className="fgr" cx="193" cy="136" r="0.6" fillOpacity="0.19"/>
<circle className="fgr" cx="449" cy="781" r="0.8" fillOpacity="0.25"/>
<circle className="fgr" cx="329" cy="223" r="0.6" fillOpacity="0.19"/>
<circle className="fgr" cx="516" cy="366" r="0.8" fillOpacity="0.19"/>
<circle className="fgr" cx="267" cy="411" r="0.8" fillOpacity="0.15"/>
<circle className="fgr" cx="359" cy="699" r="0.6" fillOpacity="0.24"/>
<circle className="fgr" cx="337" cy="539" r="0.8" fillOpacity="0.15"/>
<circle className="fgr" cx="215" cy="372" r="0.6" fillOpacity="0.22"/>
<circle className="fgr" cx="612" cy="319" r="0.6" fillOpacity="0.14"/>
<circle className="fgr" cx="379" cy="785" r="0.8" fillOpacity="0.17"/>
<circle className="fgr" cx="403" cy="603" r="0.8" fillOpacity="0.16"/>
<circle className="fgr" cx="553" cy="320" r="0.6" fillOpacity="0.21"/>
<circle className="fgr" cx="287" cy="374" r="0.6" fillOpacity="0.21"/>
<circle className="fgr" cx="347" cy="256" r="0.8" fillOpacity="0.15"/>
<circle className="fgr" cx="218" cy="154" r="0.6" fillOpacity="0.18"/>
<circle className="fgr" cx="456" cy="590" r="0.8" fillOpacity="0.25"/>
<circle className="fgr" cx="483" cy="263" r="0.8" fillOpacity="0.16"/>
<circle className="fgr" cx="497" cy="662" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="282" cy="368" r="0.6" fillOpacity="0.18"/>
<circle className="fgr" cx="535" cy="771" r="0.6" fillOpacity="0.18"/>
<circle className="fgr" cx="584" cy="399" r="0.8" fillOpacity="0.18"/>
<circle className="fgr" cx="454" cy="773" r="0.8" fillOpacity="0.2"/>
<circle className="fgr" cx="467" cy="481" r="0.8" fillOpacity="0.18"/>
<circle className="fgr" cx="467" cy="267" r="0.6" fillOpacity="0.15"/>
<circle className="fgr" cx="587" cy="824" r="0.8" fillOpacity="0.2"/>
<circle className="fgr" cx="534" cy="350" r="0.6" fillOpacity="0.17"/>
<circle className="fgr" cx="190" cy="437" r="0.8" fillOpacity="0.23"/>
<circle className="fgr" cx="387" cy="140" r="0.6" fillOpacity="0.18"/>
<circle className="fgr" cx="167" cy="503" r="0.6" fillOpacity="0.19"/>
<circle className="fgr" cx="636" cy="767" r="0.8" fillOpacity="0.25"/>
<circle className="fgr" cx="389" cy="801" r="0.6" fillOpacity="0.23"/>
<circle className="fgr" cx="364" cy="521" r="0.6" fillOpacity="0.19"/>
<circle className="fgr" cx="560" cy="522" r="0.8" fillOpacity="0.21"/>
<circle className="fgr" cx="614" cy="745" r="0.6" fillOpacity="0.16"/>
<circle className="fgr" cx="219" cy="511" r="0.8" fillOpacity="0.2"/>
<circle className="fgr" cx="248" cy="505" r="0.6" fillOpacity="0.2"/>
<circle className="fgr" cx="163" cy="816" r="0.8" fillOpacity="0.2"/>
<circle className="fgr" cx="631" cy="208" r="0.6" fillOpacity="0.22"/>
<circle className="fgr" cx="182" cy="507" r="0.8" fillOpacity="0.25"/></g>
      </g>
      <g>
<line className="fln" x1="646" y1="94" x2="646" y2="852"/>
<line className="fln" x1="92" y1="852" x2="646" y2="852"/>
<circle className="fdot" cx="92" cy="243" r="4.3"/>
<circle className="fdot" cx="92" cy="405" r="4.3"/>
<circle className="fdot" cx="92" cy="530" r="4.3"/>
<circle className="fdot" cx="279" cy="94" r="4.3"/>
<circle className="fdot" cx="429" cy="94" r="4.3"/>
<circle className="fdot" cx="92" cy="94" r="4.3"/>
<circle className="fdot" cx="646" cy="94" r="4.3"/>
<circle className="fdot" cx="646" cy="852" r="4.3"/>
<circle className="fdot" cx="92" cy="852" r="4.3"/>
      </g>
    </svg>
  )
}
