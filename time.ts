export function hktParts(date = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short"
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    timestamp: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,
    day: p.weekday,
    y: Number(p.year), m: Number(p.month), d: Number(p.day)
  };
}

export function latestFridayDate(date = new Date()) {
  const p = hktParts(date);
  const pseudo = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = pseudo.getUTCDay(); // Sun=0 ... Sat=6
  const delta = (day - 5 + 7) % 7;
  pseudo.setUTCDate(pseudo.getUTCDate() - delta);
  return pseudo.toISOString().slice(0, 10);
}

export function makeRunId(date = new Date()) {
  return hktParts(date).timestamp.replace(/[- :]/g, "") + "HKT";
}
