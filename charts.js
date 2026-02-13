// Super tiny sparklines (no deps)

export function drawSparkline(canvas, values){
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0,0,w,h);

  const nums = (values || []).map(v => (Number.isFinite(v) ? v : 0));
  const max = Math.max(1, ...nums);
  const min = Math.min(0, ...nums);

  const pad = 3;
  const innerW = w - pad*2;
  const innerH = h - pad*2;

  const toX = (i) => pad + (nums.length === 1 ? innerW/2 : (i/(nums.length-1))*innerW);
  const toY = (v) => {
    const t = (v - min) / (max - min || 1);
    return pad + (1 - t) * innerH;
  };

  // baseline
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#2a2e3b";
  ctx.stroke();

  // area
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  nums.forEach((v,i) => {
    const x = toX(i);
    const y = toY(v);
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.lineTo(toX(nums.length-1), h - pad);
  ctx.lineTo(toX(0), h - pad);
  ctx.closePath();
  ctx.fillStyle = "#2a2e3b";
  ctx.fill();

  // line
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  nums.forEach((v,i) => {
    const x = toX(i);
    const y = toY(v);
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2a2e3b";
  ctx.stroke();

  // dots
  ctx.globalAlpha = 0.65;
  nums.forEach((v,i) => {
    const x = toX(i);
    const y = toY(v);
    ctx.beginPath();
    ctx.arc(x,y,2.2,0,Math.PI*2);
    ctx.fillStyle = "#2a2e3b";
    ctx.fill();
  });
}
