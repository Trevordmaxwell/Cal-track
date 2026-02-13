export function pad2(n){ return String(n).padStart(2,"0"); }

export function dayStringFromTs(ts){
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = pad2(d.getMonth()+1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

export function prettyDate(dayStr){
  // dayStr: YYYY-MM-DD
  const [y,m,d] = dayStr.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function prettyTime(ts){
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function minutesAgoLabel(deltaMin){
  if(deltaMin === 0) return "Logging now";
  const m = Math.abs(deltaMin);
  return deltaMin < 0 ? `Logging ${m}m ago` : `Logging in ${m}m`;
}

export function uid(){
  // collision-resistant enough for personal use
  return crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

export function round1(n){
  return Math.round((n || 0)*10)/10;
}

export function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function downloadText(filename, text, mime="text/plain"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

export function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

export async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  }
}
