(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealItems = document.querySelectorAll('.reveal');

  if (reducedMotion) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => revealObserver.observe(item));
  }

  const canvas = document.getElementById('lattice-canvas');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!gl) return;

  const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute float aSize;
    uniform mat4 uProjection;
    uniform mat4 uModel;
    varying float vDepth;
    void main() {
      vec4 point = uModel * vec4(aPosition, 1.0);
      gl_Position = uProjection * point;
      gl_PointSize = aSize * (1.0 / max(0.35, point.z + 2.0));
      vDepth = clamp(1.0 - (point.z + 2.0) / 4.0, 0.0, 1.0);
    }
  `;
  const fragmentShaderSource = `
    precision mediump float;
    uniform vec3 uColor;
    varying float vDepth;
    void main() {
      float distanceFromCenter = distance(gl_PointCoord, vec2(0.5));
      float alpha = smoothstep(0.5, 0.08, distanceFromCenter) * (0.3 + vDepth * 0.7);
      gl_FragColor = vec4(uColor, alpha);
    }
  `;

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    return program;
  }

  const program = createProgram(vertexShaderSource, fragmentShaderSource);
  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  const sizeLocation = gl.getAttribLocation(program, 'aSize');
  const projectionLocation = gl.getUniformLocation(program, 'uProjection');
  const modelLocation = gl.getUniformLocation(program, 'uModel');
  const colorLocation = gl.getUniformLocation(program, 'uColor');

  const latticeSize = 5;
  const points = [];
  for (let x = -latticeSize; x <= latticeSize; x += 1) {
    for (let y = -latticeSize; y <= latticeSize; y += 1) {
      for (let z = -latticeSize; z <= latticeSize; z += 1) {
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance > latticeSize + 1.3) continue;
        const wave = Math.sin(distance * 1.8) * 0.075;
        points.push(x * 0.19 + wave, y * 0.19 + wave, z * 0.19 + wave, 3.5 + (latticeSize - distance) * 0.35);
      }
    }
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  canvas.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect();
    pointer.targetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.75;
    pointer.targetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * -0.75;
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { pointer.targetX = 0; pointer.targetY = 0; }, { passive: true });

  function perspective(out, fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
    return out;
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function rotationX(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }

  function rotationY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function translation(z) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1]);
  }

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth * pixelRatio;
    const height = canvas.clientHeight * pixelRatio;
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  let animationFrame;
  function render(time) {
    resize();
    pointer.x += (pointer.targetX - pointer.x) * 0.035;
    pointer.y += (pointer.targetY - pointer.y) * 0.035;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(sizeLocation);
    gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 16, 12);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = perspective(new Float32Array(16), Math.PI / 3.4, aspect, 0.1, 100);
    const spin = reducedMotion ? 0 : time * 0.00022;
    const rotate = multiply(rotationY(spin + pointer.x), rotationX(pointer.y + Math.sin(time * 0.00021) * 0.12));
    const model = multiply(translation(-1.7), rotate);
    gl.uniformMatrix4fv(projectionLocation, false, projection);
    gl.uniformMatrix4fv(modelLocation, false, model);
    gl.uniform3f(colorLocation, 0.78, 0.93, 0.45);
    gl.drawArrays(gl.POINTS, 0, points.length / 4);
    animationFrame = window.requestAnimationFrame(render);
  }

  window.addEventListener('resize', resize, { passive: true });
  animationFrame = window.requestAnimationFrame(render);
  window.addEventListener('pagehide', () => window.cancelAnimationFrame(animationFrame), { once: true });
})();
