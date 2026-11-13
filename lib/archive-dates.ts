export type ArchiveDateEvidence={date:string;precision:'day'|'month'|'year';evidence:string};
const months='January February March April May June July August September October November December'.split(' ');
function valid(y:number,m:number,d:number){const dt=new Date(Date.UTC(y,m-1,d,12));return y>=1800&&y<=2030&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?dt.toISOString():null;}
function dates(line:string):ArchiveDateEvidence[]{
 const out:ArchiveDateEvidence[]=[];const add=(y:number,m:number,d:number,p:'day'|'month'|'year')=>{const date=valid(y,m,d);if(date)out.push({date,precision:p,evidence:line});};
 const clean=line.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\b/gi, m => months.find(x => x.toLowerCase().startsWith(m.replace('.','').slice(0,3).toLowerCase())) || m).replace(/[*#{}\u200b]/g,' ').replace(/(\d)(st|nd|rd|th)\b/gi,'$1').replace(/\s+/g,' ').trim();
 for(const m of clean.matchAll(/\b(18\d{2}|19\d{2}|20\d{2})-(\d{1,2})-(\d{1,2})\b/g))add(+m[1],+m[2],+m[3],'day');
 for(const m of clean.matchAll(/\b(\d{1,2})[\/_-](\d{1,2})[\/_-](\d{2}|\d{4})\b/g)){const y=+m[3];add(y<100?(y<40?2000:1900)+y:y,+m[1],+m[2],'day');}
 const mon='('+months.join('|')+')';
 for(const m of clean.matchAll(new RegExp('\\b'+mon+'\\s+(\\d{1,2}),?\\s+((?:18|19|20)\\d{2})\\b','gi')))add(+m[3],months.findIndex(x=>x.toLowerCase()===m[1].toLowerCase())+1,+m[2],'day');
 for(const m of clean.matchAll(new RegExp('\\b(\\d{1,2})(?:\\s+day)?\\s+(?:of\\s+)?'+mon+'(?:\\s+in\\s+(?:the\\s+)?year)?[,]?\\s+((?:18|19|20)\\d{2})\\b','gi')))add(+m[3],months.findIndex(x=>x.toLowerCase()===m[2].toLowerCase())+1,+m[1],'day');
 if(!out.length)for(const m of clean.matchAll(new RegExp('\\b'+mon+'[,]?\\s+((?:18|19|20)\\d{2})\\b','gi')))add(+m[2],months.findIndex(x=>x.toLowerCase()===m[1].toLowerCase())+1,1,'month');
 return out;
}
export function archiveDateCandidates(title:string,content:string):ArchiveDateEvidence[]{
 // Session identifiers such as SGA-B-1819.05 are never calendar dates.
 title=title.replace(/\b(?:SGA[-_. ]*)?[BR][-. ]+\d{2,4}(?:[-.]\d{2,4})?(?:[.-]\d+)*\b/gi,'');
 content=content.replace(/[*\u200b]/g,'').replace(/\bthis\s+day\s+(\d{1,2}(?:st|nd|rd|th)?)\s+of\b/gi,'this $1 day of');
 const titleDates=dates(title);const lines=content.split('\n').map(s=>s.trim()).filter(Boolean);
 const candidates=[...titleDates];
 // Read explicit date labels anywhere, including inline covers and final-page ratification notes.
 for(const marker of content.matchAll(/\b(?:ratified|last\s+(?:revised|updated|amended)|revision\s+date|effective\s+date|date\s+(?:adopted|approved)|adopted|approved|revised|published|dated)\s*(?::|on\b|as\s+of\b)\s*([^\n]{1,100})/gi)){
  const evidence=marker[0];if(/\[unclear:|\[illegible\]/i.test(evidence))continue;
  candidates.push(...dates(evidence));
 }

 for(const clause of content.matchAll(/(?:considered|introduced|adopted|approved|enacted)\s+(?:on\s+)?(?:this\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:(?:day\s+)?of\s+)?[A-Za-z]+\s+(?:in\s+(?:the\s+)?year\s+)?(?:18|19|20)\d{2}/gi))candidates.push(...dates(clause[0]));

 for(const [i,line] of lines.entries()){
  if(line.length>350||/https?:|\[unclear:|\[illegible\]/i.test(line))continue;
  // Read date bylines, headings and explicit document-date labels; not dates in narrative prose.
  if((i<14&&(/^(?:#{1,6}\s*)?(?:date\s*:|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d|\d{1,2}[\/_-]\d{1,2}[\/_-]|(?:18|19|20)\d{2}-)/i.test(line)))||/^(?:#{1,6}\s*)?(?:dated|date|adopted|approved|revised|introduced|enacted)\s*:/i.test(line))candidates.push(...dates(line));
 }
 if(!candidates.length){const yearLine=lines.slice(0,5).find(l=>/^(?:#+\s*)?(?:18|19|20)\d{2}$/.test(l));if(yearLine){const year=yearLine.match(/\d{4}/)![0];candidates.push({date:valid(+year,1,1)!,precision:'year',evidence:yearLine});}}
 if(!candidates.length&&!/\b(?:18|19|20)\d{2}\s*[-–/]\s*(?:\d{2}|\d{4})\b/.test(title)){
  const years=[...new Set(title.match(/\b(?:18|19|20)\d{2}\b/g)||[])];
  if(years.length===1&&!/bill|resolution|\bact\b|\bS\.?\s*B\.?/i.test(title))candidates.push({date:valid(+years[0],1,1)!,precision:'year',evidence:title});
 }
 return candidates;
}
