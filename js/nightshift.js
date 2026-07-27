/* ScrappyLabs — NIGHT SHIFT.
   A live procedural night-city rendered in raw WebGL2 behind the problem picker.
   Pick a symptom and its district visibly fails; a crew pulse dispatches from the
   always-lit garage and relights it. The garage is a real button that opens the
   live in-browser agent (/scrappy/), health-gated fail-closed.

   Progressive enhancement only: reduced-motion, save-data, no-WebGL2, weak-GPU
   probe, runtime jank, or context loss all land back on today's shipped page.
   Zero contact with the film scrub engine — this touches only #picker. */
(function () {
'use strict';

var picker = document.getElementById('picker');
if (!picker) return;

/* ============================== shared state ============================== */
var NS = {
  cityOn: false,          // WebGL layer alive
  healthy: null,          // /scrappy/ demo open (null = unknown yet)
  heartbeat: null,        // set by city: fn() -> green pulse to the garage
  incident: null,         // set by city: fn(district) -> fail/dispatch/relight
  garageState: null,      // set by city: fn() -> re-render garage for health
  hover: -1               // district under a hovered/focused symptom button
};
var TEL = 'tel:+13362969877';
var SYMKEYS = ['phone', 'retype', 'archive', 'vendors', 'legacy', 'cloud'];

/* =============================== the doors =============================== */
/* Health-gated surfacing of the buried live agent. Runs at every JS tier —
   the chip works even when the canvas never mounts. Fail closed: no door is
   ever shown while the ping is red. */
var doors = (function () {
  var timer = 0, dialog = null, opener = null, lastHealthy;

  function check() {
    var ctl = new AbortController();
    var kill = setTimeout(function () { ctl.abort(); }, 5000);
    fetch('/scrappy/api/health', { signal: ctl.signal, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        NS.healthy = !!(j && j.open);
        if (NS.healthy && NS.heartbeat) NS.heartbeat();
      })
      .catch(function () { NS.healthy = false; })
      .then(function () {
        clearTimeout(kill);
        if (NS.healthy !== lastHealthy) {       // don't rebuild (and steal focus) on no-change
          lastHealthy = NS.healthy;
          if (NS.garageState) NS.garageState();
          if (!NS.healthy)                      // fail closed: minted chips die with the demo
            [].forEach.call(document.querySelectorAll('.nschip'),
              function (c) { c.parentNode && c.parentNode.removeChild(c); });
        }
      });
  }
  function start() {
    if (timer) return;
    check();
    timer = setInterval(check, 30000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearInterval(timer); timer = 0; }
    else start();
  });
  start();

  /* ---- slide-over dialog wrapping the same-origin /scrappy/ app ---- */
  function buildDialog() {
    var d = document.createElement('div');
    d.className = 'nsdlg';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', 'Talk to Scrappy — live agent');
    d.innerHTML =
      '<div class="nsdlg-scrim" data-close></div>' +
      '<div class="nsdlg-panel">' +
        '<div class="nsdlg-top"><span class="nsdlg-k"><span class="pip" aria-hidden="true"></span>Scrappy — live</span>' +
        '<button type="button" class="nsdlg-x" data-close aria-label="Close">&times;</button></div>' +
        '<iframe class="nsdlg-frame" title="Scrappy — live agent" allow="microphone"></iframe>' +
        '<div class="nsdlg-foot"><a href="/scrappy/" target="_blank" rel="noopener">Open full page &nearr;</a>' +
        '<span>The same agent answers <a href="' + TEL + '">336 · 296 · 9877</a>.</span></div>' +
      '</div>';
    d.addEventListener('click', function (e) {
      if (e.target.hasAttribute && e.target.hasAttribute('data-close')) close();
    });
    /* Escape must live on document: focus is usually inside the embed iframe,
       whose key events never bubble into this document. (Keys pressed while
       the iframe itself has focus can't be seen at all — the ✕ covers that.) */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.classList.contains('on')) close();
    });
    d.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = d.querySelectorAll('button,a[href],iframe');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });
    document.body.appendChild(d);
    return d;
  }
  function setInert(on) {
    [].forEach.call(document.body.children, function (el) {
      if (el !== dialog && el.tagName !== 'SCRIPT') el.inert = on;
    });
  }
  function open(topic) {
    if (!NS.healthy) { location.href = TEL; return; }   // door is never a dead end
    if (!dialog) dialog = buildDialog();
    opener = document.activeElement;
    dialog.querySelector('.nsdlg-frame').src =
      '/scrappy/?embed=1&topic=' + encodeURIComponent(topic || '');
    dialog.classList.add('on');
    document.documentElement.classList.add('nsdlg-lock');
    setInert(true);
    dialog.querySelector('.nsdlg-x').focus();
  }
  function close() {
    if (!dialog) return;
    dialog.classList.remove('on');
    /* about:blank, NOT removeAttribute: removing src does not unload an iframe,
       and a hidden live voice session would keep the visitor's mic hot. */
    dialog.querySelector('.nsdlg-frame').src = 'about:blank';
    document.documentElement.classList.remove('nsdlg-lock');
    setInert(false);
    if (opener && opener.isConnected && opener.focus) { opener.focus(); }
    else {
      var fb = (garageEl && garageEl.querySelector('.nsg-b')) ||
               document.querySelector('.callbtn');
      if (fb) fb.focus();
    }
  }
  return { open: open };
})();

/* ---- symptom wiring: incident choreography + the post-fix chip ----
   Registered after the page's own handler (this file is deferred), so the
   answer panel's innerHTML swap has already happened when we run. */
(function () {
  var pending = [];
  function later(fn, ms) { pending.push(setTimeout(fn, ms)); }
  function cancel() { pending.forEach(clearTimeout); pending = []; }

  function stamp() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  var count = 0;
  function onSym(i, key, label) {
    cancel();
    var ans = document.getElementById('answer');
    if (!ans) return;
    count++;
    var chipAt = 0;
    if (NS.cityOn && NS.incident) {
      NS.incident(i);
      chipAt = 3300;
      var log = document.createElement('p');
      log.className = 'nslog';
      /* decorative narration of an aria-hidden canvas — keep it out of the
         #answer live region's announcements (three updates per click otherwise) */
      log.setAttribute('aria-hidden', 'true');
      var t = stamp(), secs = 32 + ((i * 7 + count * 13) % 23);
      log.textContent = t + ' — ' + label + ' reported down.';
      ans.appendChild(log);
      later(function () { log.textContent = t + ' — crew en route.'; }, 700);
      later(function () { log.textContent = stamp() + ' — district relit. ' + secs + 's.'; }, 3200);
    }
    later(function () {
      if (!NS.healthy) return;
      var cta = ans.querySelector('.cta');
      if (!cta) return;
      var chip = document.createElement('a');
      chip.className = 'btn nschip';
      chip.href = '/scrappy/?topic=' + key;
      chip.textContent = 'That fix was scripted. This one isn’t — ask Scrappy how we’d do it on yours →';
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        doors.open(key);
      });
      cta.appendChild(chip);
    }, chipAt);
  }
  var syms = [].slice.call(document.querySelectorAll('.sym'));
  syms.forEach(function (btn, i) {
    var key = btn.dataset.k, sid = btn.querySelector('.sid');
    var label = sid ? sid.textContent : key;
    btn.addEventListener('click', function () { onSym(i, key, label); });
    btn.addEventListener('mouseenter', function () { NS.hover = i; });
    btn.addEventListener('mouseleave', function () { if (NS.hover === i) NS.hover = -1; });
    btn.addEventListener('focus', function () { NS.hover = i; });
    btn.addEventListener('blur', function () { if (NS.hover === i) NS.hover = -1; });
  });
})();

/* ================================ the city ================================ */
/* Gates, in order. Any failure = today's page, byte-identical. */
var rmq = matchMedia('(prefers-reduced-motion:reduce)');
if (rmq.matches) return;
if (navigator.connection && navigator.connection.saveData === true) return;
/* ?nsdebug — keep the city alive on weak GPUs (testing only; never linked) */
var DEBUG = /[?&]nsdebug\b/.test(location.search);

/* The whole city build (context, ~14k window candidates, 5 shader compiles)
   costs tens of ms on a midrange phone — defer it until the picker approaches
   the viewport instead of taxing page load. Doors above run immediately. */
var booted = false;
var bootIO = new IntersectionObserver(function (es) {
  for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) {
    bootIO.disconnect();
    if (!booted) { booted = true; initCity(); }
    return;
  }
}, { rootMargin: '40%' });
bootIO.observe(picker);

function initCity() {
if (rmq.matches) return;            // may have flipped since load

var canvas = document.createElement('canvas');
var gl = canvas.getContext('webgl2', {
  alpha: false, antialias: false, depth: true, powerPreference: 'low-power'
});
if (!gl) return;

/* Deterministic: PRNG seeded with the founding constant. Same city, every visit. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rnd = mulberry32(1993);

/* ------------------------------ city layout ------------------------------ */
var S = 140;                      // half-extent of the city on the ground plane
var xs = [], zs = [];             // street lines
(function () {
  var p = -S + 10;
  while (p < S - 8) { xs.push(p); p += 16 + rnd() * 12; }
  p = -S + 10;
  while (p < S - 8) { zs.push(p); p += 16 + rnd() * 12; }
})();
var NX = xs.length, NZ = zs.length;

/* Street graph: nodes at intersections, edges along streets. */
var nodes = [], adj = [], edges = [];
for (var zi = 0; zi < NZ; zi++) for (var xi = 0; xi < NX; xi++) {
  nodes.push([xs[xi], zs[zi]]); adj.push([]);
}
function nid(xi, zi) { return zi * NX + xi; }
for (var zi2 = 0; zi2 < NZ; zi2++) for (var xi2 = 0; xi2 < NX; xi2++) {
  if (xi2 + 1 < NX) { edges.push([nid(xi2, zi2), nid(xi2 + 1, zi2)]); }
  if (zi2 + 1 < NZ) { edges.push([nid(xi2, zi2), nid(xi2, zi2 + 1)]); }
}
edges.forEach(function (e, i) { adj[e[0]].push(i); adj[e[1]].push(i); });
function otherEnd(ei, n) { var e = edges[ei]; return e[0] === n ? e[1] : e[0]; }

/* Districts: 3 columns x 2 rows of the city = SYM-01..06. 6 = the garage. */
function districtOf(x, z) {
  var c = Math.min(2, Math.max(0, Math.floor((x + S) / (2 * S / 3))));
  var r = z < 0 ? 0 : 1;
  return r * 3 + c;
}
function districtCenter(d) {
  var c = d % 3, r = Math.floor(d / 3);
  return [-S + (c + 0.5) * (2 * S / 3), r === 0 ? -S / 2 : S / 2];
}
function nearestNode(x, z) {
  var best = 0, bd = 1e9;
  for (var i = 0; i < nodes.length; i++) {
    var dx = nodes[i][0] - x, dz = nodes[i][1] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function bfs(from, to) {
  var prev = new Int32Array(nodes.length).fill(-1), q = [from], seen = {};
  seen[from] = true;
  while (q.length) {
    var n = q.shift();
    if (n === to) break;
    for (var i = 0; i < adj[n].length; i++) {
      var m = otherEnd(adj[n][i], n);
      if (!seen[m]) { seen[m] = true; prev[m] = n; q.push(m); }
    }
  }
  if (to !== from && prev[to] === -1) return null;
  var path = [to], n2 = to;
  while (n2 !== from) { n2 = prev[n2]; path.push(n2); }
  return path.reverse();
}

/* Buildings: lots inside each block, taller toward the center. */
var buildings = [];               // {x,z,w,d,h,seed,district}
for (var bz = 0; bz < NZ - 1; bz++) for (var bx = 0; bx < NX - 1; bx++) {
  var x0 = xs[bx] + 1.6, x1 = xs[bx + 1] - 1.6,
      z0 = zs[bz] + 1.6, z1 = zs[bz + 1] - 1.6;
  var bw = x1 - x0, bd2 = z1 - z0;
  if (bw < 5 || bd2 < 5) continue;
  var lx = Math.max(1, Math.round(bw / 9)), lz = Math.max(1, Math.round(bd2 / 9));
  for (var li = 0; li < lx; li++) for (var lj = 0; lj < lz; lj++) {
    if (rnd() < 0.08) continue;   // empty lots keep it organic
    var cw = bw / lx, cd = bd2 / lz;
    var w = cw * (0.55 + rnd() * 0.3), d = cd * (0.55 + rnd() * 0.3);
    var cx = x0 + (li + 0.5) * cw + (rnd() - 0.5) * (cw - w) * 0.6;
    var cz = z0 + (lj + 0.5) * cd + (rnd() - 0.5) * (cd - d) * 0.6;
    var centerF = 1 - Math.min(1, Math.hypot(cx, cz) / S);
    var h = (4 + rnd() * 9) * (1 + centerF * 1.9);
    if (rnd() < 0.09 + 0.14 * centerF) h *= 1.8;
    buildings.push({ x: cx, z: cz, w: w, d: d, h: Math.min(h, 46),
                     seed: rnd(), district: districtOf(cx, cz) });
  }
}

/* The garage: a modest building near the centre. Its lights never fail. */
var garage = null, gd = 1e9;
buildings.forEach(function (b) {
  var d = Math.hypot(b.x - 6, b.z - 10);
  if (b.h < 16 && d < gd) { gd = d; garage = b; }
});
garage.district = 6;
garage.h = Math.max(8, Math.min(garage.h, 12));
var garageNode = nearestNode(garage.x, garage.z);

/* Windows: candidates on every façade, shuffled so any prefix is a spatially
   uniform subset (the degrade ladder just draws fewer instances). */
var WIN_MAX = 12000;
var winCand = [];
buildings.forEach(function (b) {
  var floors = Math.max(1, Math.floor(b.h / 2.1));
  var district = b.district;
  var faces = [
    [b.x, b.z - b.d / 2 - 0.06],   // south + north faces: vary x
    [b.x, b.z + b.d / 2 + 0.06],
    [b.x - b.w / 2 - 0.06, b.z],   // west + east faces: vary z
    [b.x + b.w / 2 + 0.06, b.z]
  ];
  for (var f = 0; f < 4; f++) {
    var span = f < 2 ? b.w : b.d;
    var cols = Math.max(1, Math.floor(span / 1.7));
    for (var fl = 0; fl < floors; fl++) for (var c = 0; c < cols; c++) {
      if (rnd() > (district === 6 ? 0.85 : 0.30)) continue;  // garage: dense, warm
      var along = -span / 2 + (c + 0.5) * (span / cols);
      var wx = f < 2 ? b.x + along : faces[f][0];
      var wz = f < 2 ? faces[f][1] : b.z + along;
      winCand.push({ x: wx, y: 1.4 + fl * 2.1, z: wz,
                     size: 0.55 + rnd() * 0.5, district: district,
                     seed: rnd(), pick: rnd() });
    }
  }
});
for (var fy = winCand.length - 1; fy > 0; fy--) {          // Fisher-Yates
  var fj = Math.floor(rnd() * (fy + 1));
  var tmp = winCand[fy]; winCand[fy] = winCand[fj]; winCand[fj] = tmp;
}
var wins = winCand.slice(0, WIN_MAX);
var winCount = wins.length;

/* ------------------------------- GL helpers ------------------------------- */
function sh(type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function prog(vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function buf(data, usage) {
  var b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
  return b;
}

/* Minimal mat4: perspective + lookAt, column-major. */
function persp(fov, aspect, near, far) {
  var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1,
          0, 0, 2 * far * near * nf, 0];
}
var camBasis = { eye: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] };
function lookAt(eye, at, up) {
  var zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  var zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  var xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
  var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  camBasis.eye = eye;
  camBasis.right = [xx, xy, xz]; camBasis.up = [yx, yy, yz];
  camBasis.fwd = [-zx, -zy, -zz];
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
          -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
          -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
          -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}

/* -------------------------------- shaders -------------------------------- */
var SPRITE_FRAG =
'#version 300 es\nprecision mediump float;\n' +
'in vec2 vUv; in vec3 vCol; out vec4 o;\n' +
'void main(){ float d=length(vUv-0.5)*2.0;\n' +
'  float core=smoothstep(0.34,0.0,d);\n' +
'  float halo=pow(max(1.0-d,0.0),2.6);\n' +
'  o=vec4(vCol*(core*1.6+halo*0.5),1.0); }';

/* Windows: fail/heal/spotlight/twinkle all in the vertex shader; the CPU only
   feeds a handful of uniforms per frame. */
var WIN_VERT =
'#version 300 es\n' +
'layout(location=0) in vec2 aC;\n' +
'layout(location=1) in vec3 aPos;\n' +
'layout(location=2) in float aSize;\n' +
'layout(location=3) in float aDist;\n' +
'layout(location=4) in float aSeed;\n' +
'layout(location=5) in float aPick;\n' +
'uniform mat4 uMV,uP; uniform float uTime,uFail,uFailT,uHealT,uHalo,uFocusY,uBand,uHover;\n' +
'uniform vec3 uHealC; uniform vec4 uSpot;\n' +
'out vec2 vUv; out vec3 vCol;\n' +
'float hash(float n){ return fract(sin(n)*43758.5453); }\n' +
'void main(){\n' +
'  vec3 amberA=vec3(1.0,0.522,0.333), amberB=vec3(1.0,0.698,0.478);\n' +
'  vec3 cool=vec3(0.788,0.820,0.871), fail=vec3(0.651,0.690,0.761);\n' +
'  vec3 col=mix(amberA,amberB,fract(aSeed*7.31));\n' +
'  if(aPick>0.93) col=cool;\n' +
'  float inten=0.72+0.28*hash(aSeed*17.0+floor(uTime*1.6+aSeed*11.0));\n' +
'  float size=aSize;\n' +
'  float sd=distance(aPos.xz,uSpot.xy);\n' +
'  float sf=(1.0-smoothstep(uSpot.z*0.35,uSpot.z,sd))*uSpot.w;\n' +
'  inten*=1.0+sf*0.30; size*=1.0+sf*0.20;\n' +
'  if(aDist<5.5 && abs(aDist-uHover)<0.5)\n' +      /* symptom hover: faint shiver */
'    inten*=0.90+0.18*hash(aSeed*23.0+floor(uTime*14.0+aSeed*9.0));\n' +
'  if(aDist<5.5 && abs(aDist-uFail)<0.5){\n' +
'    float hd=distance(aPos,uHealC);\n' +
'    float ht=clamp((uHealT*150.0-hd)/9.0,0.0,1.0);\n' +
'    float fm=uFailT*(1.0-ht);\n' +
'    float coldF=0.10+0.14*hash(aSeed*31.0+floor(uTime*12.0+aSeed*7.0));\n' +
'    inten=mix(inten,coldF,fm); col=mix(col,fail,fm*0.85);\n' +
'  }\n' +
'  vec4 vp=uMV*vec4(aPos,1.0);\n' +
'  vec4 clip=uP*vp; float ndcY=clip.y/max(clip.w,0.0001);\n' +
'  float blur=smoothstep(uBand,uBand+0.55,abs(ndcY-uFocusY));\n' +
'  size*=(1.0+blur*1.2)*uHalo; inten*=(1.0-blur*0.55);\n' +
'  vp.xy+=aC*size; gl_Position=uP*vp;\n' +
'  vUv=aC+0.5; vCol=col*inten; }';

/* Pulses: explicit colour pick, same SDF fragment. */
var PULSE_VERT =
'#version 300 es\n' +
'layout(location=0) in vec2 aC;\n' +
'layout(location=1) in vec3 aPos;\n' +
'layout(location=2) in float aSize;\n' +
'layout(location=3) in float aPick;\n' +
'layout(location=4) in float aInt;\n' +
'uniform mat4 uMV,uP; uniform float uHalo,uFocusY,uBand;\n' +
'out vec2 vUv; out vec3 vCol;\n' +
'void main(){\n' +
'  vec3 col = aPick<0.5 ? vec3(1.0,0.698,0.478) : (aPick<1.5 ? vec3(0.353,1.0,0.604) : vec3(1.0,0.42,0.208));\n' +
'  vec4 vp=uMV*vec4(aPos,1.0);\n' +
'  vec4 clip=uP*vp; float ndcY=clip.y/max(clip.w,0.0001);\n' +
'  float blur=smoothstep(uBand,uBand+0.55,abs(ndcY-uFocusY));\n' +
'  float size=aSize*(1.0+blur*1.2)*uHalo;\n' +
'  vp.xy+=aC*size; gl_Position=uP*vp;\n' +
'  vUv=aC+0.5; vCol=col*aInt*(1.0-blur*0.55); }';

var BLD_VERT =
'#version 300 es\n' +
'layout(location=0) in vec3 aV;\n' +
'layout(location=1) in vec4 aXZWD;\n' +
'layout(location=2) in vec2 aHS;\n' +
'uniform mat4 uMV,uP; uniform vec3 uFog;\n' +
'out vec3 vCol;\n' +
'void main(){\n' +
'  vec3 w=vec3(aXZWD.x+aV.x*aXZWD.z, aV.y*aHS.x, aXZWD.y+aV.z*aXZWD.w);\n' +
'  vec4 vp=uMV*vec4(w,1.0);\n' +
'  vec3 base=mix(vec3(0.056,0.068,0.098), vec3(0.088,0.104,0.150), fract(aHS.y*5.7)*0.6);\n' +
'  float fog=1.0-exp(-length(vp.xyz)*0.0052);\n' +
'  vCol=mix(base,uFog,fog);\n' +
'  gl_Position=uP*vp; }';
var BLD_FRAG =
'#version 300 es\nprecision mediump float;\nin vec3 vCol; out vec4 o;\n' +
'void main(){ o=vec4(vCol,1.0); }';

var ST_VERT =
'#version 300 es\n' +
'layout(location=0) in vec2 aQ;\n' +          /* x: 0..1 along, y: -0.5..0.5 across */
'layout(location=1) in vec4 aAB;\n' +
'uniform mat4 uMV,uP;\n' +
'void main(){\n' +
'  vec2 al=aAB.zw-aAB.xy; vec2 pp=normalize(vec2(-al.y,al.x));\n' +
'  vec2 g=aAB.xy+al*aQ.x+pp*aQ.y*0.85;\n' +
'  gl_Position=uP*(uMV*vec4(g.x,0.04,g.y,1.0)); }';
var ST_FRAG =
'#version 300 es\nprecision mediump float;\nout vec4 o;\n' +
'void main(){ o=vec4(0.651,0.690,0.761,1.0)*0.115; }';

var SKY_VERT =
'#version 300 es\n' +
'layout(location=0) in vec2 aP; out float vY;\n' +
'void main(){ vY=aP.y*0.5+0.5; gl_Position=vec4(aP,0.9999,1.0); }';
var SKY_FRAG =
'#version 300 es\nprecision mediump float;\nin float vY; out vec4 o;\n' +
'uniform float uNight;\n' +
'void main(){\n' +
'  vec3 dusk=vec3(0.075,0.090,0.133), night=vec3(0.043,0.055,0.078);\n' +
'  vec3 top=mix(dusk,night,uNight)*0.82;\n' +
'  vec3 hor=mix(dusk,night,uNight)*1.25+vec3(0.05,0.022,0.008);\n' +
'  o=vec4(mix(hor,top,smoothstep(0.0,0.75,vY)),1.0); }';

/* ------------------------------ build the GL scene ------------------------------ */
var teardownDone = false;
function teardown() {
  if (teardownDone) return;
  teardownDone = true;
  NS.cityOn = false; NS.incident = null; NS.heartbeat = null; NS.garageState = null;
  try {
    var ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  } catch (e) { /* context may already be gone */ }
  if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
  if (garageEl && garageEl.parentNode) garageEl.parentNode.removeChild(garageEl);
  if (plate) {                       // unwrap the header plate
    while (plate.firstChild) plate.parentNode.insertBefore(plate.firstChild, plate);
    plate.parentNode.removeChild(plate);
  }
  picker.classList.remove('city-on');
}

var holder = null, garageEl = null, plate = null;
var pWin, pPulse, pBld, pSt, pSky;
try {
  pWin = prog(WIN_VERT, SPRITE_FRAG);
  pPulse = prog(PULSE_VERT, SPRITE_FRAG);
  pBld = prog(BLD_VERT, BLD_FRAG);
  pSt = prog(ST_VERT, ST_FRAG);
  pSky = prog(SKY_VERT, SKY_FRAG);
} catch (e) {                         // driver refused a shader: today's page
  console.warn('nightshift: shader gate —', e.message || e);
  return;
}

/* DOM mount (probe renders at opacity 0; fade-in only after it passes) */
picker.classList.add('city-on');
holder = document.createElement('div');
holder.className = 'nscity';
holder.setAttribute('aria-hidden', 'true');
holder.appendChild(canvas);
picker.insertBefore(holder, picker.firstChild);
var wrap = picker.querySelector('.wrap');

/* Plate + garage mount only after the GPU probe passes — a weak-GPU teardown
   then never adds or removes a single node the page can feel. (The plate is
   geometry-neutral via negative margins, the garage is absolute; this defer
   makes the fallback visually seamless too.) */
function mountChrome() {
  var eb = wrap.querySelector('.eyebrow'), h2 = wrap.querySelector('.h2'),
      sub = wrap.querySelector('.sub');
  if (eb && h2 && sub) {
    plate = document.createElement('div');
    plate.className = 'nsplate';
    wrap.insertBefore(plate, eb);
    plate.appendChild(eb); plate.appendChild(h2); plate.appendChild(sub);
  }
  /* Garage door: a real button after .wrap in tab order, projected over its
     building every frame on wide screens, CSS-pinned on narrow ones. */
  garageEl = document.createElement('div');
  garageEl.className = 'nsgarage';
  picker.appendChild(garageEl);
  NS.garageState = renderGarage;
  renderGarage();
}
function renderGarage() {
  if (teardownDone || !garageEl) return;
  if (garageEl.contains(document.activeElement)) return;  // never yank live focus; next flip re-renders
  if (NS.healthy) {
    garageEl.innerHTML =
      '<button type="button" class="nsg-b">' +
      '<span class="nsg-k">The light that’s always on</span>' +
      '<span class="nsg-l"><span class="pip" aria-hidden="true"></span>Talk to Scrappy — live</span></button>';
    garageEl.querySelector('button').addEventListener('click', function () {
      doors.open('');
    });
  } else {
    garageEl.innerHTML =
      '<a class="nsg-b" href="' + TEL + '">' +
      '<span class="nsg-k">The light that’s always on</span>' +
      '<span class="nsg-l">Call the line — 336 296 9877</span></a>';
  }
}

/* ------------------------------ static buffers ------------------------------ */
var quad = buf(new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]));
var quad01 = buf(new Float32Array([0, -0.5, 1, -0.5, 0, 0.5, 1, 0.5]));
var tri = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));

var winData = new Float32Array(winCount * 7);
wins.forEach(function (w, i) {
  var o = i * 7;
  winData[o] = w.x; winData[o + 1] = w.y; winData[o + 2] = w.z;
  winData[o + 3] = w.size; winData[o + 4] = w.district;
  winData[o + 5] = w.seed; winData[o + 6] = w.pick;
});
var winBuf = buf(winData);

var bldData = new Float32Array(buildings.length * 6);
buildings.forEach(function (b, i) {
  var o = i * 6;
  bldData[o] = b.x; bldData[o + 1] = b.z; bldData[o + 2] = b.w; bldData[o + 3] = b.d;
  bldData[o + 4] = b.h; bldData[o + 5] = b.seed;
});
var bldBuf = buf(bldData);
var cubeV = buf(new Float32Array([
  -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
  -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5]));
var cubeI = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeI);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
  1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]), gl.STATIC_DRAW);

var stData = new Float32Array(edges.length * 4);
edges.forEach(function (e, i) {
  var o = i * 4;
  stData[o] = nodes[e[0]][0]; stData[o + 1] = nodes[e[0]][1];
  stData[o + 2] = nodes[e[1]][0]; stData[o + 3] = nodes[e[1]][1];
});
var stBuf = buf(stData);
/* geometry lives on the GPU now — release the CPU copies (~2MB on mobile) */
var bldCount = buildings.length;
winCand = null; wins = null; winData = null; bldData = null; stData = null;

/* --------------------------------- pulses --------------------------------- */
var PULSE_MAX = 190;
var pulses = [];                    // {edge,fromNode,t,speed,pick,size,inten,path,pi,ttl}
function edgeLen(ei) {
  var e = edges[ei];
  return Math.hypot(nodes[e[1]][0] - nodes[e[0]][0], nodes[e[1]][1] - nodes[e[0]][1]);
}
function spawnWander(pick, inten, size, node) {
  if (pulses.length >= PULSE_MAX) return null;
  var n = node == null ? Math.floor(rnd() * nodes.length) : node;
  var ei = adj[n][Math.floor(rnd() * adj[n].length)];
  var p = { edge: ei, fromNode: n, t: rnd() * 0.5, speed: (7 + rnd() * 6),
            pick: pick || 0, size: size || 1.3, inten: inten || 0.8, path: null,
            pi: 0, ttl: Infinity };
  pulses.push(p); return p;
}
function spawnPath(path, pick, size, inten, duration) {
  if (!path || path.length < 2) return null;
  var total = 0;
  for (var i = 0; i < path.length - 1; i++)
    total += Math.hypot(nodes[path[i + 1]][0] - nodes[path[i]][0],
                        nodes[path[i + 1]][1] - nodes[path[i]][1]);
  var p = { edge: -1, fromNode: path[0], t: 0, speed: total / duration,
            pick: pick, size: size, inten: inten, path: path, pi: 0, ttl: Infinity };
  pulses.push(p); return p;
}
for (var pi0 = 0; pi0 < 150; pi0++) spawnWander(0);
var pulseData = new Float32Array(PULSE_MAX * 6);
var pulseBuf = buf(pulseData, gl.STREAM_DRAW);

/* ------------------------------- incidents ------------------------------- */
var incident = null;                 // {district, phase, t0, healC, maxFail}
var lastAmbient = 0, lastInput = performance.now();

function districtRect(d) {
  var c = d % 3, r = Math.floor(d / 3);
  return [-S + c * (2 * S / 3), -S + (c + 1) * (2 * S / 3),
          r === 0 ? -S : 0, r === 0 ? 0 : S];
}
function inRect(x, z, R) { return x >= R[0] && x <= R[1] && z >= R[2] && z <= R[3]; }

var incidentSeq = 0;
function setIncident(d, ambient) {
  if (incident && !ambient) incident = null;         // user click overrides
  if (incident) return;
  var cn = nearestNode.apply(null, districtCenter(d));
  incident = {
    id: ++incidentSeq,
    district: d, t0: performance.now(), maxFail: ambient ? 0.5 : 1.0,
    healC: [nodes[cn][0], 6, nodes[cn][1]], centerNode: cn,
    crewSent: false, healed: false, ambient: !!ambient
  };
  /* pulses caught inside go dark; a crew mid-flight for a replaced incident
     is retired so its arrival can't heal the wrong district */
  var R = districtRect(d);
  pulses = pulses.filter(function (p) {
    if (p.pick === 2) return false;
    var pos = pulsePos(p);
    return !(p.pick === 0 && inRect(pos[0], pos[2], R));
  });
}
NS.incident = function (d) { setIncident(d, false); };
NS.heartbeat = function () {
  var border = nid(rnd() < 0.5 ? 0 : NX - 1, Math.floor(rnd() * NZ));
  var path = bfs(border, garageNode);
  if (path) spawnPath(path, 1, 1.5, 0.9, 2.0);
};

var posScratch = [0, 0.35, 0];      // shared: ~9k allocations/s saved at the 150-pulse floor
function pulsePos(p) {
  var a, b;
  if (p.path) { a = nodes[p.path[p.pi]]; b = nodes[p.path[p.pi + 1]]; }
  else { a = nodes[p.fromNode]; b = nodes[otherEnd(p.edge, p.fromNode)]; }
  posScratch[0] = a[0] + (b[0] - a[0]) * p.t;
  posScratch[2] = a[1] + (b[1] - a[1]) * p.t;
  return posScratch;
}
function stepPulses(dt) {
  var failing = incident && !incident.healed ? districtRect(incident.district) : null;
  for (var i = pulses.length - 1; i >= 0; i--) {
    var p = pulses[i];
    var a, bN;
    if (p.path) { a = p.path[p.pi]; bN = p.path[p.pi + 1]; }
    else { a = p.fromNode; bN = otherEnd(p.edge, p.fromNode); }
    var len = Math.hypot(nodes[bN][0] - nodes[a][0], nodes[bN][1] - nodes[a][1]);
    p.t += (p.speed * dt) / Math.max(len, 0.01);
    p.ttl -= dt;
    if (p.ttl <= 0) { pulses.splice(i, 1); continue; }
    if (p.t >= 1) {
      p.t = 0;
      if (p.path) {
        p.pi++;
        if (p.pi >= p.path.length - 1) {
          if (p.pick === 2 && incident && p.inc === incident.id) beginHeal();
          pulses.splice(i, 1); continue;
        }
      } else {
        p.fromNode = bN;
        var opts = adj[bN].filter(function (ei) {
          if (ei === p.edge) return false;
          if (failing && p.pick === 0) {
            var m = nodes[otherEnd(ei, bN)];
            if (inRect(m[0], m[1], failing)) return false;
          }
          return true;
        });
        if (!opts.length) opts = [p.edge];
        p.edge = opts[Math.floor(rnd() * opts.length)];
      }
    }
  }
  while (pulses.length < 150) spawnWander(0);
}
function beginHeal() {
  if (!incident || incident.healed) return;
  incident.healed = true;
  incident.healT0 = performance.now();
  var R = districtRect(incident.district);
  for (var i = 0; i < 5; i++) {
    var n = incident.centerNode;
    var p = spawnWander(1, 0.8, 1.0, n);
    if (p) p.ttl = 6;
  }
}
function incidentUniforms(now) {
  if (!incident) return { fail: -1, failT: 0, healT: 0, healC: [0, 0, 0] };
  var e = (now - incident.t0) / 1000;
  var failT = Math.min(1, e / 0.6) * incident.maxFail;
  if (!incident.crewSent && e >= 0.6) {
    incident.crewSent = true;
    var path = bfs(garageNode, incident.centerNode);
    var crew = path && path.length > 1 ? spawnPath(path, 2, 1.9, 1.0, 1.4) : null;
    if (crew) crew.inc = incident.id;
    else beginHeal();
  }
  var healT = 0;
  if (incident.healed) {
    healT = Math.min(1, (now - incident.healT0) / 1200);
    if (healT >= 1 && now - incident.healT0 > 1800) {
      var out = { fail: incident.district, failT: failT, healT: 1, healC: incident.healC };
      incident = null;
      return out;
    }
  }
  return { fail: incident.district, failT: failT, healT: healT, healC: incident.healC };
}

/* --------------------------------- camera --------------------------------- */
var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
var proj = persp(35 * Math.PI / 180, 1, 1, 900);
function resize() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  var W = Math.round(w * DPR), H = Math.round(h * DPR);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
    proj = persp(35 * Math.PI / 180, W / H, 1, 900);
  }
}
addEventListener('resize', resize, { passive: true });

var spot = { x: 0, z: 0, r: 26, s: 0, tx: 0, tz: 0, ts: 0 };
picker.addEventListener('pointermove', function (e) {
  if (teardownDone) return;
  lastInput = performance.now();
  var r = canvas.getBoundingClientRect();
  if (!r.width) return;
  var nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  var ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
  ptrX = nx; ptrY = ny;
  var tanF = Math.tan(17.5 * Math.PI / 180), aspect = r.width / r.height;
  var d = [
    camBasis.fwd[0] + nx * tanF * aspect * camBasis.right[0] + ny * tanF * camBasis.up[0],
    camBasis.fwd[1] + nx * tanF * aspect * camBasis.right[1] + ny * tanF * camBasis.up[1],
    camBasis.fwd[2] + nx * tanF * aspect * camBasis.right[2] + ny * tanF * camBasis.up[2]];
  if (d[1] < -0.02) {
    var t = -camBasis.eye[1] / d[1];
    spot.tx = camBasis.eye[0] + d[0] * t;
    spot.tz = camBasis.eye[2] + d[2] * t;
    spot.ts = 1;
  }
}, { passive: true });
picker.addEventListener('pointerleave', function () { spot.ts = 0; }, { passive: true });
var ptrX = 0, ptrY = 0;

/* Scroll progress through the section drives the dolly. Natural traversal —
   the section's height is never changed, so no downstream offsets move. */
var prog01 = 0;
function readProgress() {
  var r = picker.getBoundingClientRect();
  prog01 = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height)));
}

/* -------------------------------- rendering -------------------------------- */
var haloMult = 3.5, drawWins = winCount, rung = 0;
var frameAvg = 8, rollStart = 0, rollSum = 0, rollN = 0;
var visible = false, frozen = false, permaFrozen = false, raf = 0, lastT = 0,
    skip = false, lastScroll = scrollY;
var probeN = 0, probeSum = 0, probing = true;

var io = new IntersectionObserver(function (es) {
  visible = es[es.length - 1].isIntersecting;
  if (visible && !raf && !teardownDone && !permaFrozen) start();
}, { rootMargin: '15%' });
io.observe(picker);

document.addEventListener('visibilitychange', function () {
  if (!document.hidden && visible && !raf && !teardownDone && !permaFrozen) start();
});
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
  addEventListener(ev, function () {
    lastInput = performance.now();
    if (frozen && !permaFrozen && !teardownDone) { frozen = false; if (visible && !raf) start(); }
  }, { passive: true });
});
addEventListener('scroll', function () {
  lastInput = performance.now();
  readProgress();
  if (frozen && !permaFrozen && !teardownDone) { frozen = false; if (visible && !raf) start(); }
}, { passive: true });

canvas.addEventListener('webglcontextlost', function (e) {
  e.preventDefault(); teardown();
}, false);
rmq.addEventListener('change', function () { if (rmq.matches) teardown(); });

function setSprite(program, buffer, stride, attrs) {
  gl.useProgram(program);
  for (var da = 1; da <= 6; da++) gl.disableVertexAttribArray(da);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  var off = 0;
  attrs.forEach(function (a) {
    gl.enableVertexAttribArray(a[0]);
    gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, stride * 4, off * 4);
    gl.vertexAttribDivisor(a[0], 1);
    off += a[1];
  });
}
var uCache = new Map();
function u(p, n) {
  var k = uCache.get(p);
  if (!k) { k = {}; uCache.set(p, k); }
  if (!(n in k)) k[n] = gl.getUniformLocation(p, n);
  return k[n];
}

var t0 = performance.now();
function frame(now) {
  raf = 0;
  if (teardownDone) return;
  if (document.hidden || !visible) return;      // restarted by the observers
  var dt = lastT ? (now - lastT) / 1000 : 0.016;
  var ft = lastT ? now - lastT : 8;

  /* fast-scroll: give the film acts' seek decode the bus every other frame.
     lastT deliberately not updated on a skipped frame, so the next counted
     interval spans the pair and the probe/ladder still see true render cost. */
  var sd = Math.abs(scrollY - lastScroll); lastScroll = scrollY;
  if (sd > 120 && !skip) { skip = true; raf = requestAnimationFrame(frame); return; }
  skip = false;
  lastT = now;

  /* probe: 30 hidden frames, then either fade in or vanish */
  if (probing) {
    probeN++; probeSum += ft;
    if (probeN >= 30) {
      probing = false;
      if (probeSum / probeN > 18 && !DEBUG) { teardown(); return; }
      canvas.classList.add('on');
      mountChrome();
    }
  } else {
    /* one-way degrade ladder on a rolling 3s average */
    rollSum += ft; rollN++;
    if (now - rollStart > 3000) {
      var avg = rollSum / Math.max(rollN, 1);
      rollStart = now; rollSum = 0; rollN = 0;
      if (avg > 20 && !DEBUG) {
        rung++;
        if (rung === 1) haloMult = 2.0;
        else if (rung === 2) drawWins = Math.floor(winCount / 2);
        else if (rung === 3) { DPR = 1; resize(); }
        else {
          /* final still, for good: unwire the choreography so symptom clicks
             fall back to the no-city path instead of narrating a dead canvas.
             The garage stays — it's DOM, not canvas. */
          incident = null; NS.incident = null; NS.heartbeat = null; NS.cityOn = false;
          renderScene(now); frozen = permaFrozen = true; return;
        }
      }
    }
    if (performance.now() - lastInput > 90000) {            // battery freeze
      renderScene(now); frozen = true; return;
    }
  }

  /* idle ambience: the night shift runs itself */
  if (!probing && !incident && now - lastInput > 8000 && now - lastAmbient > 22000) {
    lastAmbient = now;
    setIncident(Math.floor(rnd() * 6), true);
  }

  spot.x += (spot.tx - spot.x) * 0.12;
  spot.z += (spot.tz - spot.z) * 0.12;
  spot.s += (spot.ts - spot.s) * 0.08;
  stepPulses(Math.min(dt, 0.05));
  renderScene(now);
  raf = requestAnimationFrame(frame);
}
function start() {
  if (permaFrozen || teardownDone) return;
  lastT = 0; rollStart = performance.now(); rollSum = 0; rollN = 0;
  readProgress(); resize();
  raf = requestAnimationFrame(frame);
}

function renderScene(now) {
  resize();
  var t = (now - t0) / 1000;

  /* camera: overview dropping to the tilt-shift street angle as you scroll */
  var az = -0.62 + Math.sin(t * Math.PI * 2 / 60) * 0.052 + ptrX * 0.035;
  var el = (43 - prog01 * 22) * Math.PI / 180 + ptrY * -0.035;
  var rad = 205 - prog01 * 58;
  var eye = [Math.sin(az) * Math.cos(el) * rad, Math.sin(el) * rad,
             Math.cos(az) * Math.cos(el) * rad];
  var mv = lookAt(eye, [0, 8, 0], [0, 1, 0]);
  var inc = incidentUniforms(now);
  var focusY = -0.08, band = 0.35 - prog01 * 0.17;

  gl.clearColor(0.043, 0.055, 0.078, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  /* sky */
  gl.useProgram(pSky);
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 0);
  for (var da = 1; da <= 5; da++) gl.disableVertexAttribArray(da);
  gl.uniform1f(u(pSky, 'uNight'), 0.35 + prog01 * 0.65);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  /* buildings: the only depth writers */
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.useProgram(pBld);
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeV);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bldBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.uniformMatrix4fv(u(pBld, 'uMV'), false, mv);
  gl.uniformMatrix4fv(u(pBld, 'uP'), false, proj);
  gl.uniform3f(u(pBld, 'uFog'), 0.055, 0.068, 0.098);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeI);
  gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, bldCount);

  /* everything luminous: additive, depth-tested, no depth writes */
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  /* streets */
  gl.useProgram(pSt);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad01);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, stBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.disableVertexAttribArray(2);
  gl.uniformMatrix4fv(u(pSt, 'uMV'), false, mv);
  gl.uniformMatrix4fv(u(pSt, 'uP'), false, proj);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, edges.length);

  /* windows */
  setSprite(pWin, winBuf, 7, [[1, 3], [2, 1], [3, 1], [4, 1], [5, 1]]);
  gl.uniformMatrix4fv(u(pWin, 'uMV'), false, mv);
  gl.uniformMatrix4fv(u(pWin, 'uP'), false, proj);
  gl.uniform1f(u(pWin, 'uTime'), t);
  gl.uniform1f(u(pWin, 'uFail'), inc.fail);
  gl.uniform1f(u(pWin, 'uFailT'), inc.failT);
  gl.uniform1f(u(pWin, 'uHealT'), inc.healT);
  gl.uniform3f(u(pWin, 'uHealC'), inc.healC[0], inc.healC[1], inc.healC[2]);
  gl.uniform4f(u(pWin, 'uSpot'), spot.x, spot.z, spot.r, spot.s);
  gl.uniform1f(u(pWin, 'uHover'), NS.hover);
  gl.uniform1f(u(pWin, 'uHalo'), haloMult);
  gl.uniform1f(u(pWin, 'uFocusY'), focusY);
  gl.uniform1f(u(pWin, 'uBand'), band);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawWins);

  /* pulses */
  var n = Math.min(pulses.length, PULSE_MAX);
  for (var i = 0; i < n; i++) {
    var p = pulses[i], pos = pulsePos(p), o = i * 6;
    pulseData[o] = pos[0]; pulseData[o + 1] = pos[1]; pulseData[o + 2] = pos[2];
    pulseData[o + 3] = p.size; pulseData[o + 4] = p.pick; pulseData[o + 5] = p.inten;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, pulseData, 0, n * 6);
  setSprite(pPulse, pulseBuf, 6, [[1, 3], [2, 1], [3, 1], [4, 1]]);
  gl.uniformMatrix4fv(u(pPulse, 'uMV'), false, mv);
  gl.uniformMatrix4fv(u(pPulse, 'uP'), false, proj);
  gl.uniform1f(u(pPulse, 'uHalo'), haloMult);
  gl.uniform1f(u(pPulse, 'uFocusY'), focusY);
  gl.uniform1f(u(pPulse, 'uBand'), band);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);

  /* project the garage onto the page and park its button there */
  positionGarage(mv);
}

var gx = -1, gy = -1;               // smoothed sign position
var blockCache = null, blockTick = 0, pickerH = 0, gw2 = 60, gh = 54;
function refreshBlocks(pr) {
  /* copy rects are scroll-invariant relative to the section; re-read them
     every ~30 frames instead of every frame (answer content changes on click) */
  blockCache = [];
  ['.symlist', '.answer', '.nsplate'].forEach(function (sel) {
    var el = picker.querySelector(sel);
    if (!el) return;
    var b = el.getBoundingClientRect();
    blockCache.push([b.left - pr.left - 12, b.right - pr.left + 12,
                     b.top - pr.top - 12, b.bottom - pr.top + 12]);
  });
  pickerH = picker.offsetHeight;
  gw2 = garageEl.offsetWidth / 2; gh = garageEl.offsetHeight;
}
function positionGarage(mv) {
  if (!garageEl) return;
  if (innerWidth < 900) return;     // narrow layouts: the sign is CSS-pinned
  var w = [garage.x, garage.h + 3, garage.z];
  var vx = mv[0] * w[0] + mv[4] * w[1] + mv[8] * w[2] + mv[12];
  var vy = mv[1] * w[0] + mv[5] * w[1] + mv[9] * w[2] + mv[13];
  var vz = mv[2] * w[0] + mv[6] * w[1] + mv[10] * w[2] + mv[14];
  var cx = proj[0] * vx, cy = proj[5] * vy, cw = -vz;
  if (cw <= 0.01) return;
  var r = canvas.getBoundingClientRect(), pr = picker.getBoundingClientRect();
  if (--blockTick <= 0 || !blockCache) { refreshBlocks(pr); blockTick = 30; }
  var sx = (cx / cw * 0.5 + 0.5) * r.width + (r.left - pr.left);
  var sy = (-cy / cw * 0.5 + 0.5) * r.height + (r.top - pr.top);
  /* The sign must never sit on the copy: if the projected spot hits a copy
     block, drop it into the band below that block. */
  for (var i = 0; i < blockCache.length; i++) {
    var B = blockCache[i];
    if (sx + gw2 > B[0] && sx - gw2 < B[1] && sy > B[2] && sy - gh < B[3])
      sy = Math.max(sy, B[3] + gh + 14);
  }
  sx = Math.min(Math.max(sx, gw2 + 6), pr.width - gw2 - 6);
  sy = Math.min(Math.max(sy, gh + 6), pickerH - 16);
  if (gx < 0) { gx = sx; gy = sy; }
  gx += (sx - gx) * 0.15; gy += (sy - gy) * 0.15;
  garageEl.style.transform =
    'translate(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px) translate(-50%,-100%)';
}

NS.cityOn = true;
readProgress();
resize();
if (visible) start();
}                                   /* end initCity */
})();
