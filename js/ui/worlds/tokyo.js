/* Tokyo, after the last train. Every line is drawn here, without image assets. */
export function tokyoArt() {
  return `<svg class="world-art tokyo-art" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="tokyo-wall" x2="1" y2="1"><stop stop-color="var(--tokyo-wall-top)"/><stop offset="1" stop-color="var(--tokyo-wall-bottom)"/></linearGradient>
    <linearGradient id="tokyo-sky" x2="0" y2="1"><stop stop-color="var(--tokyo-sky-top)"/><stop offset=".68" stop-color="var(--tokyo-sky-mid)"/><stop offset="1" stop-color="var(--tokyo-horizon)"/></linearGradient>
    <radialGradient id="tokyo-haze"><stop stop-color="var(--tokyo-mist)" stop-opacity=".6"/><stop offset="1" stop-color="var(--tokyo-mist)" stop-opacity="0"/></radialGradient>
    <radialGradient id="tokyo-lamp-pool"><stop stop-color="#ffc49b" stop-opacity=".38"/><stop offset=".45" stop-color="#e495ae" stop-opacity=".12"/><stop offset="1" stop-color="#de80ce" stop-opacity="0"/></radialGradient>
    <radialGradient id="tokyo-violet-glow"><stop stop-color="#dd83ff" stop-opacity=".68"/><stop offset=".27" stop-color="#b43cf4" stop-opacity=".3"/><stop offset="1" stop-color="#a639ed" stop-opacity="0"/></radialGradient>
    <radialGradient id="tokyo-cyan-glow"><stop stop-color="#6bebff" stop-opacity=".5"/><stop offset=".3" stop-color="#42b7dc" stop-opacity=".2"/><stop offset="1" stop-color="#428dc8" stop-opacity="0"/></radialGradient>
    <linearGradient id="tokyo-desk" x2="0" y2="1"><stop stop-color="var(--tokyo-wood-top)"/><stop offset="1" stop-color="var(--tokyo-wood-bottom)"/></linearGradient>
    <linearGradient id="tokyo-glass" x2="1" y2="1"><stop stop-color="#a8bdeb" stop-opacity=".05"/><stop offset=".4" stop-color="#a8bdeb" stop-opacity="0"/><stop offset="1" stop-color="#d191e6" stop-opacity=".12"/></linearGradient>
    <linearGradient id="tokyo-curtain" x2="1"><stop stop-color="var(--tokyo-fabric)"/><stop offset=".4" stop-color="var(--tokyo-fabric-fold)"/><stop offset=".65" stop-color="var(--tokyo-fabric)"/><stop offset="1" stop-color="var(--tokyo-fabric-fold)"/></linearGradient>
    <linearGradient id="tokyo-tower" x2="0" y2="1"><stop stop-color="#ffd6fc"/><stop offset=".45" stop-color="#f69cfa"/><stop offset="1" stop-color="#c76ce8"/></linearGradient>
    <linearGradient id="tokyo-neon-edge" x2="1"><stop stop-color="#b66cf7" stop-opacity="0"/><stop offset=".55" stop-color="#c47bff" stop-opacity=".85"/><stop offset="1" stop-color="#70eaff" stop-opacity=".9"/></linearGradient>
    <pattern id="tokyo-windows-far" width="27" height="37" patternUnits="userSpaceOnUse"><path d="M5 8h3v9H5z M17 8h3v9h-3z" fill="var(--tokyo-window-dim)" opacity=".45"/><path d="M17 8h3v9h-3z" fill="var(--tokyo-window-lit)" opacity=".45"/></pattern>
    <pattern id="tokyo-windows-mid" width="43" height="46" patternUnits="userSpaceOnUse"><path d="M8 9h8v13H8z M27 9h8v13h-8z" fill="var(--tokyo-window-dim)" opacity=".46"/><path d="M8 9h8v13H8z" fill="var(--tokyo-window-lit)" opacity=".54"/><path d="M8 26h27" stroke="var(--tokyo-city-line)" stroke-opacity=".5"/></pattern>
    <pattern id="tokyo-windows-near" width="60" height="49" patternUnits="userSpaceOnUse"><path d="M10 11h15v20H10z M35 11h15v20H35z" fill="var(--tokyo-window-dim)" opacity=".5"/><path d="M11 12h13v18H11z" fill="var(--tokyo-window-warm)" opacity=".6"/><path d="M18 12v18 M10 22h15 M42 12v18" stroke="var(--tokyo-building-front)" stroke-width="2"/><path d="M0 40h60" stroke="var(--tokyo-city-line)" stroke-opacity=".25"/></pattern>
    <pattern id="tokyo-rain-lines" width="213" height="190" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><path d="M17 5v23 M89 79v36 M166 33v18 M188 145v31 M44 154v16 M122 163v13" stroke="var(--tokyo-rain)" stroke-width=".9" stroke-linecap="round" opacity=".42"/><path d="M61 26v10 M143 103v17 M202 75v9" stroke="var(--tokyo-rain)" stroke-width="1.4" stroke-linecap="round" opacity=".16"/></pattern>
    <clipPath id="tokyo-window-clip"><rect x="357" y="84" width="1165" height="689" rx="5"/></clipPath>
    <clipPath id="tokyo-near-clip"><path d="M1145 470h111v-23h47v23h88v327h-246z M1343 357h118v-26h24v26h58v440h-200z M916 581h161v216H916z"/></clipPath>
  </defs>

  <!-- A room in the eaves. Architectural lines keep the texture quiet. -->
  <path fill="url(#tokyo-wall)" d="M0 0h1600v1000H0z"/>
  <path d="M0 0h1600v33L313 52 0 108z" fill="var(--tokyo-ceiling)"/>
  <path d="M0 108 313 52 1600 33 M313 52v716 M0 902l313-134 1287 19" fill="none" stroke="var(--tokyo-room-line)" stroke-width="2"/>
  <path d="M0 902 313 768l1287 19v213H0z" fill="var(--tokyo-floor)"/>
  <g fill="none" stroke="var(--tokyo-room-line)" stroke-width="1" opacity=".45"><path d="M0 959l477-188 M227 1000l450-227 M575 1000l302-224 M960 1000l114-220 M1350 1000l-77-217 M0 933l1600-65 M0 982l1600-31"/></g>

  <!-- The city is seen through one generous pane, with rain on the outside. -->
  <rect x="337" y="64" width="1208" height="734" rx="12" fill="var(--tokyo-frame-shadow)"/>
  <rect x="350" y="77" width="1179" height="702" rx="7" fill="var(--tokyo-frame-light)"/>
  <g clip-path="url(#tokyo-window-clip)">
    <path d="M350 78h1180v710H350z" fill="url(#tokyo-sky)"/>
    <ellipse class="tokyo-clouds" cx="1223" cy="431" rx="546" ry="326" fill="url(#tokyo-haze)"/>
    <ellipse cx="677" cy="597" rx="464" ry="227" fill="url(#tokyo-haze)" opacity=".42"/>
    <circle class="tokyo-moon" cx="1318" cy="180" r="44" fill="var(--tokyo-moon)" opacity=".66"/>
    <path d="M1073 222c82-33 136-11 202-24s138-42 257-16 M409 244c124-33 208-32 305-16" fill="none" stroke="var(--tokyo-cloud)" stroke-width="13" stroke-linecap="round" opacity=".1"/>
    <!-- Far skyline: rooftop tanks, antennae and hundreds of small lives. -->
    <path d="M349 516h48V386h57v-45h9v45h34v91h34V411h66v-26h34v26h10v105h22V324h75v-16h12v16h35v188h25V436h47v-72h12v72h33v70h31V355h63v-24h23v24h18v139h28V428h67v-17h22v17h16v79h21V318h37v-22h8v22h57v176h37V410h31v-26h33v26h26v100h16V372h49v-51h10v51h23v139h35V398h91v-21h21v21h27v398H349z" fill="var(--tokyo-building-far)"/>
    <path d="M349 516h48V386h100v91h34V411h110v105h22V324h122v188h25V436h92v70h31V355h104v139h28V428h105v79h21V318h102v176h37V410h90v100h16V372h82v139h35V398h139v398H349z" fill="url(#tokyo-windows-far)"/>
    <!-- Tokyo Tower: a delicate warm landmark, not a generic skyscraper. -->
    <g transform="translate(1068 220)" fill="none" stroke="url(#tokyo-tower)" stroke-linejoin="round">
      <path d="M0 354 57 77 114 354 M57 77V3 M48 79h18 M38 128h38 M27 190h60 M13 266h88 M0 354h114" stroke-width="3"/>
      <path d="M12 296h90 M19 244h76 M31 171h52 M44 104h26 M51 53h12 M53 28h8 M50 79l26 49-38 43 49 73-74 52 101 58 M64 79l-26 49 45 43-64 73 83 52L0 354" stroke-width="1.4"/>
      <path d="M31 164h52v18H31z M16 238h82v18H16z" fill="var(--tokyo-tower-deck)" stroke-width="1.3"/>
      <path d="M34 170h46 M20 245h74" stroke="#ffe1bd" opacity=".8"/>
      <path d="M34 354c1-54 12-75 23-75s22 21 23 75" stroke-width="3"/>
      <circle class="tokyo-beacon" cx="57" cy="3" r="3" fill="#ffd0cb" stroke="none"/>
    </g>
    <!-- Mid-distance terraces and railings. -->
    <path d="M345 607V483h85v-28h44v28h31v115h26V525h96v-19h33v19h28v81h26V449h119v-21h29v21h23v181h23V541h113v-29h33v29h35v256H345z" fill="var(--tokyo-building-mid)"/>
    <path d="M345 607V483h160v115h26V525h157v81h26V449h177v181h23V541h181v256H345z" fill="url(#tokyo-windows-mid)"/>
    <g fill="none" stroke="var(--tokyo-city-line)" stroke-width="1.5" opacity=".65"><path d="M354 482v-16h141v16 M359 466v16m19-16v16m19-16v16m19-16v16m19-16v16m19-16v16m19-16v16 M724 449v-19h131v19 M728 430v19m19-19v19m19-19v19m19-19v19m19-19v19m19-19v19m19-19v19 M543 579h133 M543 588h133 M919 606h160 M919 615h160"/></g>
    <!-- Near buildings, with balconies and their own little signs. -->
    <path d="M1145 470h111v-23h47v23h88v327h-246z M1343 357h118v-26h24v26h58v440h-200z M916 581h161v216H916z" fill="var(--tokyo-building-front)"/>
    <g clip-path="url(#tokyo-near-clip)"><path d="M902 320h650v480H902z" fill="url(#tokyo-windows-near)"/><path d="M1343 360h25v440 M1145 472h19v325 M916 584h16v214" stroke="var(--tokyo-city-line)" stroke-width="3" opacity=".3"/></g>
    <g stroke="var(--tokyo-city-line)" stroke-width="1.5" fill="none" opacity=".75"><path d="M1360 410h158v21h-158z M1360 459h158v21h-158z M1360 508h158v21h-158z M1360 557h158v21h-158z M1360 606h158v21h-158z M1360 655h158v21h-158z M1369 410v21m27-21v21m27-21v21m27-21v21m27-21v21m27-21v21 M1177 504h184 M1177 553h184 M1177 602h184 M1177 651h184 M1177 700h184"/></g>
    <g fill="var(--tokyo-city-line)" opacity=".7"><rect x="1257" y="431" width="44" height="16" rx="2"/><rect x="1266" y="421" width="25" height="10" rx="2"/><rect x="1465" y="313" width="17" height="18"/></g>
    <g class="tokyo-electric-windows" fill="#82d6ef" opacity=".72"><path d="M1391 362h12v18h-12z M1451 460h13v20h-13z M1391 607h13v20h-13z M1171 558h12v20h-12z M1232 607h12v20h-12z M932 705h13v20h-13z M992 656h13v20h-13z"/></g>
    <g class="tokyo-city-glow"><ellipse cx="1259" cy="591" rx="175" ry="241" fill="url(#tokyo-violet-glow)"/><ellipse cx="1015" cy="624" rx="173" ry="127" fill="url(#tokyo-cyan-glow)"/><ellipse cx="1441" cy="386" rx="196" ry="115" fill="url(#tokyo-violet-glow)"/></g>
    <!-- Signs glow softly; no flashing advertisements in a writer's room. -->
    <g class="tokyo-neon">
      <rect x="1238" y="508" width="48" height="163" rx="4" fill="var(--tokyo-sign)" stroke="#e1a4ff" stroke-width="1.4"/>
      <path d="M1242 513h40v153h-40z" fill="none" stroke="#de8aff" stroke-opacity=".45"/>
      <text x="1262" y="541" fill="#f1c8ff" font-size="24" font-family="serif" text-anchor="middle">本<tspan x="1262" dy="35">と</tspan><tspan x="1262" dy="35">珈</tspan><tspan x="1262" dy="35">琲</tspan></text>
      <rect x="973" y="611" width="85" height="31" rx="3" fill="var(--tokyo-sign)" stroke="#70eaff" stroke-width="1.2"/>
      <text x="1015" y="633" fill="#b1f5ff" font-size="18" font-family="serif" letter-spacing="5" text-anchor="middle">喫茶</text>
      <path d="M1379 386h125" stroke="#d787ff" stroke-width="2"/>
      <path d="M1379 389h125" stroke="#d787ff" stroke-width="6" opacity=".12"/>
    </g>
    <g fill="var(--tokyo-building-front)" opacity=".76"><path d="M1389 362h57v21h-57z M1450 411h42v20h-42z M1390 510h56v21h-56z M1450 608h42v21h-42z M1179 509h24v22h-24z M1179 607h23v22h-23z M1237 706h25v22h-25z M932 607h25v22h-25z M993 706h25v22h-25z"/></g>
    <path d="M349 729c229-24 430 31 623 3s347 22 552-23v99H349z" fill="var(--tokyo-near-haze)" opacity=".34"/>
    <g class="tokyo-train" fill="var(--tokyo-window-warm)"><rect x="603" y="739" width="68" height="3" rx="1.5"/><rect x="677" y="739" width="68" height="3" rx="1.5"/><rect x="751" y="739" width="68" height="3" rx="1.5"/></g>
    <path d="M347 78h1185v715H347z" fill="url(#tokyo-glass)"/>
    <g class="tokyo-rain"><path d="M300-130h1300v1120H300z" fill="url(#tokyo-rain-lines)"/></g>
    <g class="tokyo-droplets" fill="none" stroke="var(--tokyo-rain)" stroke-linecap="round" opacity=".26"><path d="M477 191c-1 23-8 40-7 64m3 8v8 M845 134c0 47-8 47-8 85m0 9v12 M1220 282c-4 28 1 31-5 51m-2 9v5 M1432 111c-4 41-2 53-7 72 M1017 467c-2 15-6 23-5 34"/></g>
  </g>
  <!-- Deep window reveals, brass catches and a thin violet reflection. -->
  <g fill="var(--tokyo-frame)"><path d="M344 76h16v708h-16z M1519 76h16v708h-16z M351 766h1180v16H351z M351 76h1180v11H351z M903 80h13v691h-13z M1307 80h11v691h-11z"/><path d="M352 333h1176v8H352z"/></g>
  <g fill="none" stroke="var(--tokyo-frame-light)" stroke-width="1.2"><path d="M361 88v677h1155 M917 88v678 M1319 88v678 M359 342h1158"/></g>
  <rect x="887" y="427" width="8" height="49" rx="4" fill="var(--tokyo-hardware)"/>
  <rect x="1326" y="427" width="8" height="49" rx="4" fill="var(--tokyo-hardware)"/>
  <path d="M338 783h1207l-22 23H322z" fill="var(--tokyo-sill)"/>
  <path d="M340 783h1201" stroke="url(#tokyo-neon-edge)" stroke-width="2"/>

  <path class="tokyo-interior-neon" d="M335 807h1210" fill="none" stroke="#c47bff" stroke-width="2" opacity=".68"/>
  <path class="tokyo-interior-neon" d="M335 809h1210" fill="none" stroke="#c47bff" stroke-width="7" opacity=".09"/>

  <!-- A gathered linen curtain gives the city a quiet, human frame. -->
  <path d="M1535 54c-8 186-12 395-58 604l31 20c-8 56-2 127 19 170l73 19V54z" fill="url(#tokyo-curtain)"/>
  <g fill="none" stroke="var(--tokyo-fabric-line)" stroke-width="1.5" opacity=".5"><path d="M1550 59c-3 213-11 400-59 600 M1577 59c-1 202-17 451-69 609 M1594 62c6 240-12 471-68 613 M1512 678c7 58 1 110 20 159 M1534 683c4 52 10 111 32 164"/></g>
  <path d="M1478 656q29 20 67 16l-6 16q-41 3-64-16z" fill="var(--tokyo-hardware)"/>
  <path d="M1479 664q33 17 61 13" fill="none" stroke="var(--tokyo-lamp-light)" opacity=".5"/>

  <!-- The left wall: slim bookshelves and a framed moon print. -->
  <g transform="translate(60 168) rotate(-2)">
    <rect width="184" height="232" rx="2" fill="var(--tokyo-frame-shadow)" stroke="var(--tokyo-room-line)" stroke-width="3"/>
    <rect x="12" y="12" width="160" height="208" fill="var(--tokyo-print)"/>
    <circle cx="94" cy="88" r="42" fill="var(--tokyo-print-moon)" opacity=".7"/>
    <path d="M15 158q53-48 86-22t68-11v92H15z" fill="var(--tokyo-print-hill)"/>
    <path d="M14 180q41-20 78-5t78-14v57H14z" fill="var(--tokyo-print-fore)"/>
    <path d="M78 187h39 M88 194h19" stroke="var(--tokyo-print-moon)" stroke-width="1" opacity=".6"/>
  </g>
  <g transform="translate(20 451)">
    <path d="M0 85h275v12H0z M14 97v20h8V97 M246 97v20h8V97" fill="var(--tokyo-wood-bottom)"/>
    <path d="M0 85h275" stroke="var(--tokyo-room-line)" stroke-width="2"/><path class="tokyo-interior-neon" d="M4 98h265" stroke="#b772e8" stroke-width="1.5" opacity=".7"/><path class="tokyo-interior-neon" d="M4 102h265" stroke="#b772e8" stroke-width="8" opacity=".07"/>
    <g stroke="var(--tokyo-book-line)" stroke-width="1.2">
      <path d="M14 8h20v77H14z" fill="var(--tokyo-book-purple)"/><path d="M35 1h17v84H35z" fill="var(--tokyo-book-blue)"/><path d="M54 16h28v69H54z" fill="var(--tokyo-book-rose)"/><path d="M85 5h15v80H85z" fill="var(--tokyo-book-cream)"/><path d="M105 2h23v83h-23z" fill="var(--tokyo-book-purple)"/><path d="m135 12 17-3 17 73-17 3z" fill="var(--tokyo-book-blue)"/>
      <path d="M18 17h12m-12 5h12m-12 52h12 M39 9h9m-9 63h9 M60 25h16m-16 5h16 M90 15h5m-5 55h5 M110 12h13m-13 6h13m-13 55h13" fill="none" opacity=".65"/>
    </g>
    <path d="M188 54h63l-7 31h-49z" fill="var(--tokyo-pot)"/><path d="M197 57h46" stroke="var(--tokyo-pot-line)"/>
    <g stroke="var(--tokyo-leaf-line)" fill="var(--tokyo-leaf)"><path d="M217 56c-4-28 16-44 18-49 7 28 4 35-18 49z M216 54c-21-5-30-23-29-36 25 8 34 17 29 36z M218 53c11-18 28-20 39-17-6 19-22 24-39 17z"/></g>
  </g>
  <!-- A low record cabinet, a turntable and spines of favorite albums. -->
  <g transform="translate(-14 720)">
    <path d="M0 41h304v164H0z" fill="var(--tokyo-wood-bottom)" stroke="var(--tokyo-room-line)"/>
    <path d="M0 41 22 25h294l-12 16z" fill="var(--tokyo-wood-top)"/>
    <path d="M15 61h129v122H15z M157 61h130v122H157z" fill="var(--tokyo-cabinet-dark)"/>
    <g stroke="var(--tokyo-record-line)" stroke-width="3"><path d="M25 73v99 M34 70v102 M43 76v96 M53 70v102 M63 72v100 M74 77v95 M85 70v102 M96 73v99 M107 74v98 M118 70v102 M130 79v93"/></g>
    <g transform="translate(165 73)"><rect width="111" height="91" rx="4" fill="var(--tokyo-speaker)" stroke="var(--tokyo-room-line)"/><circle cx="31" cy="43" r="22" fill="var(--tokyo-cabinet-dark)" stroke="var(--tokyo-room-line)"/><circle cx="31" cy="43" r="10" fill="var(--tokyo-speaker)"/><circle cx="81" cy="29" r="12" fill="var(--tokyo-cabinet-dark)"/><path d="M66 65h28" stroke="var(--tokyo-record-line)" stroke-width="2"/></g>
    <path d="M40 6h187v27H40z" fill="var(--tokyo-turntable)" stroke="var(--tokyo-room-line)"/><ellipse cx="108" cy="9" rx="53" ry="16" fill="var(--tokyo-record)" stroke="var(--tokyo-record-line)"/><ellipse cx="108" cy="9" rx="38" ry="11" fill="none" stroke="var(--tokyo-record-line)" opacity=".5"/><ellipse cx="108" cy="9" rx="17" ry="5" fill="var(--tokyo-book-rose)"/><path d="M192 1 171 17l-20 1" fill="none" stroke="var(--tokyo-hardware)" stroke-width="3" stroke-linecap="round"/><circle cx="210" cy="22" r="2" fill="#9acac4"/>
    <path d="M20 205v29h12l6-29 M263 205l6 29h12v-29" fill="var(--tokyo-wood-bottom)"/>
  </g>

  <!-- The writing desk and an amber task lamp: a little warmth in the blue. -->
  <ellipse cx="1421" cy="744" rx="335" ry="285" fill="url(#tokyo-lamp-pool)"/>
  <path d="M1026 848h574v37h-606z" fill="url(#tokyo-desk)"/>
  <path d="M994 885h606v18H994z" fill="var(--tokyo-wood-bottom)"/>
  <path class="tokyo-interior-neon" d="M1003 896h596" stroke="#c378f2" stroke-width="1.4" opacity=".7"/>
  <path d="M1037 904h15l-15 96h-13z M1545 904h16l20 96h-14z" fill="var(--tokyo-wood-bottom)"/>
  <path d="M1043 853h526 M1129 862h384 M1022 873h224 M1284 876h276" stroke="var(--tokyo-wood-grain)" stroke-width="1" opacity=".5"/>
  <g class="tokyo-lamp">
    <ellipse cx="1458" cy="842" rx="55" ry="11" fill="var(--tokyo-lamp-metal)"/>
    <path d="m1459 838-26-97 43-101" fill="none" stroke="var(--tokyo-lamp-metal)" stroke-width="9" stroke-linecap="round"/>
    <path d="m1462 836-22-95 40-94" fill="none" stroke="var(--tokyo-hardware)" stroke-width="1.5"/>
    <circle cx="1433" cy="741" r="9" fill="var(--tokyo-lamp-metal)" stroke="var(--tokyo-hardware)"/>
    <path d="m1475 621 51 26-42 36-67-30z" fill="var(--tokyo-lamp-metal)" stroke="var(--tokyo-room-line)"/>
    <path d="m1419 653 64 29-6 5-62-29z" fill="var(--tokyo-lamp-light)"/>
    <path d="m1420 662-120 177h240l-64-152z" fill="var(--tokyo-lamp-light)" opacity=".045"/>
  </g>
  <!-- An open journal, tucked letters, a fountain pen and tea. -->
  <g transform="translate(1185 813)">
    <path d="M0 21 76 10l78 17-75 17z" fill="var(--tokyo-book-purple)" stroke="var(--tokyo-book-line)"/>
    <path d="M5 18 76 6l72 18-69 14z" fill="var(--tokyo-journal)"/>
    <path d="M76 6 79 38 M10 22l65-11 M83 12l57 13" fill="none" stroke="var(--tokyo-journal-line)" stroke-width=".8"/>
    <path d="m16 22 45-7m-38 11 43-7m-34 11 35-6m26-9 32 7m-32-3 42 9m-41-4 30 6" fill="none" stroke="var(--tokyo-journal-line)" stroke-width=".7" opacity=".7"/>
    <path d="M58 30 21 44l-9-2 6-5 37-12z" fill="var(--tokyo-pen)"/><path d="m18 37 3 7-9-2z" fill="var(--tokyo-hardware)"/>
    <path d="M82 39v14l4-3 3 4V37" fill="var(--tokyo-book-rose)"/>
  </g>
  <g transform="translate(1371 812)">
    <ellipse cx="0" cy="30" rx="35" ry="8" fill="var(--tokyo-cup-shadow)"/>
    <ellipse cx="0" cy="29" rx="29" ry="6" fill="var(--tokyo-ceramic)"/>
    <path d="M18-1c22-7 28 20 6 22" fill="none" stroke="var(--tokyo-ceramic)" stroke-width="5"/>
    <path d="M-23-5h46l-4 28c-2 10-35 10-38 0z" fill="var(--tokyo-ceramic)"/>
    <ellipse cy="-5" rx="23" ry="7" fill="var(--tokyo-cup-rim)"/>
    <ellipse cy="-4" rx="19" ry="4" fill="var(--tokyo-tea)"/>
    <g class="tokyo-steam" fill="none" stroke="var(--tokyo-steam)" stroke-width="1.4" stroke-linecap="round"><path d="M-7-17c-13-18 11-21 0-41 M6-24c12-17-8-21 2-38"/></g>
    <path d="M-16 1v17" stroke="var(--tokyo-cup-rim)" stroke-width="2" stroke-linecap="round"/>
  </g>
  <!-- A climbing plant catches the reflected neon. -->
  <g transform="translate(1132 830)">
    <path d="M-35-62h68l-9 64c-14 11-32 11-47 0z" fill="var(--tokyo-pot)" stroke="var(--tokyo-pot-line)"/>
    <ellipse cy="-62" rx="34" ry="8" fill="var(--tokyo-pot-dark)" stroke="var(--tokyo-pot-line)"/>
    <path d="M-24-49h48 M-21-34h42 M-19-19h38 M-16-4h32" stroke="var(--tokyo-pot-line)" opacity=".5"/>
    <g fill="none" stroke="var(--tokyo-stem)" stroke-width="2"><path d="M0-62c2-63-13-108-30-153 M0-62c13-82 40-111 56-157 M-1-64c-9-35-37-48-65-77 M4-65c3-35 22-47 48-64"/></g>
    <g class="tokyo-leaves" fill="var(--tokyo-leaf)" stroke="var(--tokyo-leaf-line)" stroke-width="1">
      <path d="M-19-152c-39 9-57-17-63-41 25-19 60-3 63 41z"/>
      <path d="M-27-191c-28-28-20-58 0-73 27 25 28 51 0 73z"/>
      <path d="M-10-115c-9-34 1-56 23-69 21 30 12 54-23 69z"/>
      <path d="M25-137c-9-40 4-64 34-75 11 40 3 62-34 75z"/>
      <path d="M46-192c-3-32 10-51 36-51 5 32-5 47-36 51z"/>
      <path d="M-51-128c-37 11-63-6-67-33 32-12 57 2 67 33z"/>
      <path d="M25-101c31 12 54 0 61-23-31-16-51-8-61 23z"/>
    </g>
    <g fill="none" stroke="var(--tokyo-leaf-line)" stroke-width="1.1" opacity=".7"><path d="m-19-152-53-32m45-7 1-62m16 138 20-56m15 34 28-62m-7 7 28-41m-125 105-56-27m132 54 49-19"/></g>
  </g>
  <path d="M1063 968q61-36 131 0l18 32h-166z" fill="var(--tokyo-chair)" stroke="var(--tokyo-room-line)" stroke-width="2"/>
  <path d="M1077 968q48-23 102 0" fill="none" stroke="var(--tokyo-fabric-line)" opacity=".55"/>
</svg>`;
}
