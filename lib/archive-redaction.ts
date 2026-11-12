/** Narrow identifier/credential redaction; policy mentions without values remain. */
export function redactArchiveSecrets(text:string):string {
 return text
 .replace(/\b\d{3}[-\u2010-\u2014 ]\d{2}[-\u2010-\u2014 ]\d{4}\b/g,'[REDACTED: personal identifier]')
 .replace(/((?:\b(?:email |instagram |twitter )?password)\s*[:=]\s*(?:\*\*)?)[^\r\n]+/gi,'$1[REDACTED: credential]')
 .replace(/((?:\bSSN|\bSS#|\bbank account number|\brouting number)\s*(?:\*\*)?\s*:\s*(?:\*\*)?)[^\r\n]*\d[^\r\n]*/gi,'$1[REDACTED: financial identifier]');
}
