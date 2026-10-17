/* The academy is drawn here, one shape at a time. No photograph or image asset. */
export function academyArt() {
  const books = (x, y, widths, height = 83) => {
    let left = x;
    return widths.map((width, i) => {
      const h = height - [0, 11, 5, 17, 3, 9, 14][i % 7];
      const book = `<g transform="translate(${left} ${y - h})">
        <rect width="${width - 2}" height="${h}" rx="2" fill="var(--academy-book-${i % 4})"/>
        <path d="M3 4V${h - 3}" stroke="var(--academy-book-edge)" opacity=".36"/>
        <path d="M3 10h${width - 8}m-${width - 8} ${h - 23}h${width - 8}" stroke="var(--academy-gold)" stroke-width="1.3" opacity=".65"/>
        <path d="M${(width - 2) / 2} ${h / 2 - 5}l3 5-3 5-3-5z" fill="none" stroke="var(--academy-gold)" opacity=".45"/>
      </g>`;
      left += width;
      return book;
    }).join('');
  };
  const stars = [[1003,118,1.4],[1118,168,1.1],[1431,182,1.8],[1263,228,1.4],[1177,295,1.1],[1461,338,1.6],[1052,392,1],[1381,444,1.2],[1156,402,1.6],[1302,128,1.2],[1478,251,1],[1373,291,1.4],[1228,358,1],[1110,266,1],[1338,386,1.5]].map(([x,y,r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--academy-star)"/>`).join('');
  const leaves = [[1512,158,-20],[1544,190,120],[1507,235,-34],[1537,278,135],[1495,315,-25],[1534,352,120],[1503,393,-40],[1540,438,145],[1512,478,-25],[1538,514,130],[1508,557,-30],[1540,602,133],[1500,646,-45],[1521,688,120]].map(([x,y,angle])=> `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0C-8-12-3-28 5-35C15-21 15-8 0 0" fill="var(--academy-leaf)"/><path d="M0 0L5-29" fill="none" stroke="var(--academy-leaf-vein)" stroke-width=".8" opacity=".65"/></g>`).join('');
  return `<svg class="world-art academy-art" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="academy-wall" x2="0" y2="1"><stop stop-color="var(--academy-wall-top)"/><stop offset="1" stop-color="var(--academy-wall-bottom)"/></linearGradient>
    <linearGradient id="academy-sky" x2=".25" y2="1"><stop stop-color="var(--academy-sky-top)"/><stop offset=".58" stop-color="var(--academy-sky-mid)"/><stop offset="1" stop-color="var(--academy-sky-bottom)"/></linearGradient>
    <linearGradient id="academy-wood" x2="1" y2=".1"><stop stop-color="var(--academy-wood-dark)"/><stop offset=".46" stop-color="var(--academy-wood-mid)"/><stop offset=".72" stop-color="var(--academy-wood-dark)"/><stop offset="1" stop-color="var(--academy-wood-edge)"/></linearGradient>
    <linearGradient id="academy-stone" x2="1" y2="0"><stop stop-color="var(--academy-stone-dark)"/><stop offset=".35" stop-color="var(--academy-stone)"/><stop offset=".7" stop-color="var(--academy-stone)"/><stop offset="1" stop-color="var(--academy-stone-dark)"/></linearGradient>
    <linearGradient id="academy-desk" x2="0" y2="1"><stop stop-color="var(--academy-desk-top)"/><stop offset="1" stop-color="var(--academy-wood-dark)"/></linearGradient>
    <linearGradient id="academy-beam" x1="1" y1="0" x2="0" y2="1"><stop stop-color="var(--academy-light)" stop-opacity=".11"/><stop offset="1" stop-color="var(--academy-light)" stop-opacity="0"/></linearGradient>
    <radialGradient id="academy-halo"><stop stop-color="#ffe0a0" stop-opacity=".24"/><stop offset=".26" stop-color="#f7b85e" stop-opacity=".08"/><stop offset="1" stop-color="#efb76d" stop-opacity="0"/></radialGradient>
    <radialGradient id="academy-moon-halo"><stop stop-color="var(--academy-moon)" stop-opacity=".19"/><stop offset="1" stop-color="var(--academy-moon)" stop-opacity="0"/></radialGradient>
    <linearGradient id="academy-paper" x2=".2" y2="1"><stop stop-color="var(--academy-paper-light)"/><stop offset="1" stop-color="var(--academy-paper)"/></linearGradient>
    <linearGradient id="academy-feather" x2="1" y2=".7"><stop stop-color="var(--academy-feather-light)"/><stop offset=".5" stop-color="var(--academy-feather)"/><stop offset="1" stop-color="var(--academy-feather-dark)"/></linearGradient>
    <clipPath id="academy-window"><path d="M1048 831V352C1048 196 1158 124 1285 54C1412 124 1522 196 1522 352V831Z"/></clipPath>
    <pattern id="academy-wall-grain" width="82" height="82" patternUnits="userSpaceOnUse"><path d="M5 18h1m37 24h1M18 68h1m47-55h1M73 65h1" stroke="var(--academy-grain)" stroke-width="1" opacity=".2"/></pattern>
  </defs>

  <!-- A quiet stretch of plaster leaves room for the novel. -->
  <path fill="url(#academy-wall)" d="M0 0h1600v1000H0z"/>
  <path fill="url(#academy-wall-grain)" d="M0 0h1600v1000H0z"/>
  <path d="M245 0v1000M267 0v1000M957 0v1000M982 0v1000" stroke="var(--academy-wall-line)" opacity=".36"/>
  <path d="M267 98h690M267 108h690M267 859h690M267 868h690" stroke="var(--academy-wall-line)" opacity=".32"/>
  <path d="M280 873h665v127H280z" fill="var(--academy-wainscot)" opacity=".45"/>
  <path d="M290 889h145v111m23 0V889h145v111m23 0V889h145v111m23 0V889h139v111" fill="none" stroke="var(--academy-wall-line)" opacity=".4"/>

  <!-- The library's restrained astronomical frieze. -->
  <g fill="none" stroke="var(--academy-gold)" opacity=".23">
    <path d="M358 55h142m217 0h142M377 49h117m229 0h117" stroke-width=".8"/>
    <circle cx="609" cy="55" r="34"/><ellipse cx="609" cy="55" rx="47" ry="16" transform="rotate(-24 609 55)"/>
    <path d="M609 12v86m-43-43h86m-73-30 60 60m-60 0 60-60" stroke-width=".65"/>
    <circle cx="609" cy="55" r="10"/>
    <path d="m349 55 5-5 5 5-5 5Zm510 0 5-5 5 5-5 5Z" fill="var(--academy-gold)"/>
    <path d="M303 32v29l12 13m601-42v29l-12 13"/>
  </g>

  <!-- Deep, curved bookcase, built from individual leather-bound volumes. -->
  <path d="M0 0h228v1000H0z" fill="var(--academy-wood-dark)"/>
  <path d="M5 78Q107-11 210 78v864H5Z" fill="var(--academy-shelf-shadow)" stroke="var(--academy-wood-edge)" stroke-width="2"/>
  <path d="M-15 89Q107-35 228 89M-15 104Q107-20 228 104" fill="none" stroke="url(#academy-wood)" stroke-width="18"/>
  <path d="M7 87Q107 0 207 87" fill="none" stroke="var(--academy-gold)" stroke-width="1.2" opacity=".42"/>
  <g opacity=".94">
    ${books(9,208,[18,23,14,25,18,16,22,20,17,15],89)}
    ${books(-3,346,[24,19,26,18,15,22,17,24,19,19],97)}
    ${books(9,485,[15,20,23,17,21,18,25,16,18,19],93)}
    ${books(-4,624,[24,17,19,22,27,16,21,23,17,15],97)}
    ${books(12,764,[18,27,19,18,21,16,23,17,21],95)}
    ${books(-2,902,[22,17,25,16,20,26,17,20,19,16],93)}
  </g>
  <g fill="url(#academy-wood)" stroke="var(--academy-wood-edge)" stroke-width="1">
    <path d="M0 210h215v16H0zm0 138h215v16H0zm0 139h215v16H0zm0 139h215v16H0zm0 139h215v16H0zm0 139h215v16H0z"/>
    <path d="M209 77h26v923h-26z"/>
    <path d="M201 77h42v13h-42zm3 237h36v13h-36zm0 365h36v13h-36zm-3 267h42v19h-42z"/>
  </g>
  <path d="M219 97v205m0 37v328m0 37v227" stroke="var(--academy-gold)" opacity=".25"/>
  <g fill="none" stroke="var(--academy-gold)" opacity=".42"><path d="m221 358 7 17-7 17-7-17Zm0 335 7 17-7 17-7-17Z"/><path d="M217 418v141m8-141v141" stroke-width=".65"/></g>

  <!-- The great window: dawn and moonlight are painted with the same shapes. -->
  <path d="M1017 852V353C1017 179 1145 96 1285 19C1425 96 1553 179 1553 353V852Z" fill="var(--academy-window-shadow)"/>
  <path d="M1031 846V353C1031 186 1153 109 1285 37C1417 109 1539 186 1539 353V846Z" fill="url(#academy-stone)" stroke="var(--academy-stone-edge)" stroke-width="1.5"/>
  <g clip-path="url(#academy-window)">
    <path d="M1025 35h520v810h-520z" fill="url(#academy-sky)"/>
    <circle cx="1378" cy="204" r="154" fill="url(#academy-moon-halo)"/>
    <g class="academy-stars" opacity=".8">${stars}<path d="M1199 174v10m-5-5h10m214 176v12m-6-6h12" stroke="var(--academy-star)" stroke-width="1"/></g>
    <path class="academy-night-moon" d="M1406 162C1370 147 1339 176 1348 208C1356 236 1390 247 1415 226C1387 230 1368 206 1377 181C1382 168 1393 163 1406 162Z" fill="var(--academy-moon)"/>
    <circle class="academy-day-sun" cx="1378" cy="204" r="35" fill="var(--academy-moon)"/>
    <g fill="var(--academy-cloud)" opacity=".2">
      <path d="M1028 289c54-5 77-19 116-16 39 3 44 18 84 13 42-6 78-8 119 6l-319 11Z"/>
      <path d="M1241 354c44-15 68-8 103-12 37-4 67-23 93-15 26 7 58 20 116 14v16Z"/>
    </g>
    <g fill="var(--academy-cloud)" opacity=".12"><path d="M1074 430c58-9 89-22 143-18 55 4 66 16 117 8 51-8 94-5 140 12Z"/></g>
    <path d="M1027 666c58-72 103-74 152-59 55-69 114-67 176-15 74-40 123-21 192 34v226h-520Z" fill="var(--academy-hills-far)"/>
    <path d="M1027 708c93-71 157-35 229-59 91-32 187-10 291 56v147h-520Z" fill="var(--academy-hills)"/>

    <!-- The far academy, with irregular roofs, lit windows, and steep spires. -->
    <g fill="var(--academy-castle)" stroke="var(--academy-castle-edge)" stroke-width="1">
      <path d="M1078 731V596h25v-27h20v27h25v135Zm-7-135 42-68 42 68Z"/>
      <path d="M1110 537v-31m-4 12h12" fill="none"/>
      <path d="M1150 741V641h75v100m-80-100 43-31 43 31Z"/>
      <path d="M1228 751V560h36v-20h17v20h37v191m-97-190 52-100 52 100Z"/>
      <path d="M1273 470v-37m0 7 25 8-25 7"/>
      <path d="M1320 751V632h60v119m-66-119 36-49 36 49Z"/>
      <path d="M1383 755V596h44v159m-50-159 28-74 28 74Z"/>
      <path d="M1430 768V670h66v98m-71-98 38-33 38 33Z"/>
      <path d="M1082 735h434v95h-434z"/>
    </g>
    <g fill="var(--academy-castle-window)" opacity=".85">
      <path d="M1103 620q6-10 12 0v19h-12Zm0 49q6-10 12 0v19h-12Zm71-11q5-8 10 0v15h-10Zm24 0q5-8 10 0v15h-10Zm48-61q5-10 10 0v24h-10Zm31-18q5-10 10 0v24h-10Zm20 61q5-10 10 0v22h-10Zm-51 20q5-10 10 0v22h-10Zm90 1q6-10 12 0v20h-12Zm57-40q5-9 10 0v19h-10Zm10 51q5-9 10 0v19h-10Zm44 28q5-8 10 0v15h-10Zm25 0q5-8 10 0v15h-10Z"/>
    </g>
    <path d="M1025 801c77-30 147-22 217-29 132-12 171-1 301 17v62h-518Z" fill="var(--academy-hills-near)"/>
    <g fill="none" stroke="var(--academy-lake)" opacity=".28"><path d="M1144 794h49m65-7h104m-179 17h148m-167 13h47m91-9h128m-164 19h58m98-12h47"/></g>
  </g>

  <!-- Stone tracery and slender leaded glass, drawn over the landscape. -->
  <path d="M1048 831V352C1048 196 1158 124 1285 54C1412 124 1522 196 1522 352V831Z" fill="none" stroke="var(--academy-stone-edge)" stroke-width="3"/>
  <path d="M1048 380C1122 358 1197 291 1285 179C1373 291 1448 358 1522 380M1048 405C1130 382 1204 323 1285 221C1366 323 1440 382 1522 405" fill="none" stroke="var(--academy-stone-dark)" stroke-width="8"/>
  <path d="M1285 179V831M1167 329V831M1403 329V831M1048 536h474M1048 702h474" stroke="var(--academy-stone-dark)" stroke-width="9"/>
  <path d="M1282 184V829M1164 332V829M1400 332V829M1050 533h470M1050 699h470" stroke="var(--academy-stone-edge)" stroke-width="1" opacity=".6"/>
  <g fill="none" stroke="var(--academy-window-lead)" stroke-width=".7" opacity=".4">
    <path d="m1048 410 119 126-119 166m119-373 118 207-118 166-119 129m237-610 118 315-118 166-118 129m236-502 119 207-119 166-118 129m237-295-119 166 119 129"/>
    <path d="m1167 329-119 207 119 166 118 129m118-502-118 207 118 166 119 129m-237-610-118 315 118 166 118 129m119-426-119 131 119 166"/>
  </g>
  <path d="M1027 833h518l21 21v15h-561v-15Z" fill="url(#academy-stone)" stroke="var(--academy-stone-edge)"/>
  <path d="M1045 870h482v16h-482" fill="var(--academy-stone-dark)"/>
  <path d="m1047 403-425 462h690l209-331" fill="url(#academy-beam)"/>

  <!-- An ivy stem has found its way in from the courtyard. -->
  <g class="academy-ivy"><path d="M1542 60c-44 100 1 166-22 228-28 76 30 119 4 192-21 59 16 101-10 154-19 38 6 56-2 88" fill="none" stroke="var(--academy-leaf-stem)" stroke-width="2.2"/>${leaves}</g>

  <!-- Candles on the sill. The glow is a painted gradient, not a rendering filter. -->
  <g class="academy-candle-glow"><ellipse cx="1127" cy="741" rx="120" ry="150" fill="url(#academy-halo)"/><ellipse cx="1483" cy="727" rx="125" ry="155" fill="url(#academy-halo)"/></g>
  <g>
    <path d="M1119 755h16v74h-16z" fill="var(--academy-wax)"/><path d="M1119 755c3 7 5-3 8 3 3 8 5-1 8-2v20c-3-8-4 8-7 1-3-6-5 3-5-5v-9" fill="var(--academy-wax-light)"/>
    <path d="M1127 754v-7" stroke="var(--academy-wood-dark)" stroke-width="1.7"/>
    <path class="academy-flame academy-flame-one" d="M1127 748c-13-8-6-19 1-29-2 10 10 19-1 29Z" fill="#eab765"/><path class="academy-flame academy-flame-one" d="M1127 746c-6-4-2-10 1-13 3 7 4 9-1 13Z" fill="#fff2c9"/>
    <path d="M1109 828q18 8 36 0l-4 8h-28Zm18 8v9m-10 0h20" fill="var(--academy-brass)" stroke="var(--academy-gold)" stroke-width="1.3"/>
    <path d="M1474 745h18v84h-18z" fill="var(--academy-wax)"/><path d="M1474 745c4 7 6-3 8 4 3 7 5-2 10-3v17c-4-4-4 6-7 3-3-3-3-14-6-8l-5-1Z" fill="var(--academy-wax-light)"/>
    <path d="M1483 745v-7" stroke="var(--academy-wood-dark)" stroke-width="1.7"/>
    <path class="academy-flame academy-flame-two" d="M1483 740c-13-9-7-21 2-34-3 14 11 23-2 34Z" fill="#eab765"/><path class="academy-flame academy-flame-two" d="M1483 737c-6-4-3-11 1-15 3 7 4 11-1 15Z" fill="#fff2c9"/>
    <path d="M1465 828q18 8 36 0l-4 8h-28Zm18 8v9m-10 0h20" fill="var(--academy-brass)" stroke="var(--academy-gold)" stroke-width="1.3"/>
  </g>

  <!-- The foreground writing table: a small invitation to begin. -->
  <path d="M1150 913h450v87H996Z" fill="url(#academy-desk)" stroke="var(--academy-wood-edge)" stroke-width="1.5"/>
  <path d="M1029 978h571m-536-14h390m-352-15h304m-265-13h210" stroke="var(--academy-wood-edge)" stroke-width=".65" opacity=".3"/>
  <path d="M1139 932q62-18 121-6l20 44q-60-13-123 5Z" fill="url(#academy-paper)" stroke="var(--academy-paper-edge)"/>
  <path d="M1260 926q56-13 113-3l28 45q-65-9-121 2Z" fill="url(#academy-paper)" stroke="var(--academy-paper-edge)"/>
  <path d="m1260 926 20 44m-134-32q60-14 110-7m-108 12q58-14 110-7m-106 12q58-14 108-7m-104 12q58-14 107-7m16-14q45-10 91-4m-87 8q44-10 90-4m-86 9q42-10 89-4" fill="none" stroke="var(--academy-ink)" stroke-width=".8" opacity=".35"/>
  <path d="m1156 976 124-3 121-2-1 6-119-1-123 4Z" fill="var(--academy-book-0)"/>
  <path d="M1410 917q20-8 40 0l5 29q-25 13-50 0Z" fill="var(--academy-ink-glass)" stroke="var(--academy-gold)" stroke-width="1.2"/>
  <ellipse cx="1430" cy="916" rx="20" ry="6" fill="var(--academy-ink)" stroke="var(--academy-gold)"/>
  <path d="m1412 923-1 15q4 3 7 3" fill="none" stroke="var(--academy-glass-shine)" stroke-width="2" opacity=".5"/>
  <g class="academy-quill">
    <path d="M1431 920c-2-51 6-96 44-150-3 29 8 42-7 64 15-9 12 8 2 23 8-5 0 16-10 25l-21 26Z" fill="url(#academy-feather)"/>
    <path d="M1431 923c5-60 16-102 44-153m-39 128 24-20m-21 8 28-24m-25 11 29-26m-24 11 22-23m-18 8 18-22m-14 9 17-24" fill="none" stroke="var(--academy-feather-line)" stroke-width=".9"/>
    <path d="m1436 894-5-17m8 5-6-22m10 8-6-23m11 10-8-22m12 11-7-23m12 11-7-19" fill="none" stroke="var(--academy-feather-line)" stroke-width=".7" opacity=".6"/>
  </g>
  <g class="academy-ink-ribbon" fill="none" stroke="var(--academy-ink-magic)" stroke-linecap="round">
    <path d="M1428 909c-58-36-26-61-60-75-43-17-79 7-70 28 10 24 47 11 34-7-21-29-97-20-106-63-8-36 30-50 47-30" stroke-width="1.5" opacity=".44"/>
    <path d="M1437 898c-20-46 30-67 12-98-14-25-49-13-36 8 7 11 22 11 32 6" stroke-width="1" opacity=".36"/>
    <path d="M1358 826c-8-12-4-22 8-29m-124-28c-11-12-7-25 2-30" stroke-width=".8" opacity=".3"/>
  </g>
  <g class="academy-ink-sparks" fill="var(--academy-ink-magic)"><path d="m1304 805 2-6 2 6 6 2-6 2-2 6-2-6-6-2Zm90 54 1-4 1 4 4 1-4 1-1 4-1-4-4-1Zm-134-108 1-4 1 4 4 1-4 1-1 4-1-4-4-1Z"/><circle cx="1372" cy="817" r="1.5"/><circle cx="1251" cy="792" r="1.4"/><circle cx="1407" cy="880" r="1"/></g>

  <!-- Brass armillary sphere and a few books in the near corner. -->
  <path d="M0 940h255l74 60H0Z" fill="url(#academy-desk)"/>
  <path d="M15 931h129l8 13H20Z" fill="var(--academy-book-0)" stroke="var(--academy-gold)" stroke-width=".6"/>
  <path d="M21 917h111l6 14H17Z" fill="var(--academy-book-2)"/><path d="M26 921h101l3 5H23Z" fill="var(--academy-paper)"/>
  <g transform="translate(177 865)" stroke="var(--academy-gold)" fill="none">
    <circle r="57" stroke-width="3"/><ellipse rx="41" ry="57" transform="rotate(-26)" stroke-width="2"/><ellipse rx="57" ry="17" transform="rotate(-26)" stroke-width="2"/><ellipse rx="17" ry="57" transform="rotate(38)" stroke-width="1.2" opacity=".65"/>
    <path d="m-41-60 82 120m-46-126 9 14M30 48l9 14" stroke-width="2"/><circle r="9" fill="var(--academy-brass)" stroke-width="1.4"/>
    <path d="M-19 54q19 8 38 0m-19 5v16m-25 5q25-14 50 0Z" fill="var(--academy-brass)" stroke-width="2"/>
    <path d="m-55-12 5 1m-2 31 5-2m16 29 3-4m36 14-1-5m30-8-3-3m20-27-5-1m-3-34-4 3m-24-24-2 4m-32-6 1 5m-29 10 4 3" stroke-width="1.4"/>
  </g>
  <path d="M0 982h281l20 18H0Z" fill="var(--academy-wood-dark)"/>
  </svg>`;
}
