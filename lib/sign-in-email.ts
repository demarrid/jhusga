import type { Mail } from "@/lib/resend";

/** Email clients need inline styles and table layout; keep a plain-text fallback. */
export function signInEmail(code: string, minutes: number): Omit<Mail, "to"> {
    if (!/^\d{6}$/.test(code) || !Number.isInteger(minutes) || minutes < 1) {
        throw new Error("Invalid sign-in email parameters");
    }
    return {
        subject: `${code} is your jhusga.org sign-in code`,
        text: [
            `Your sign-in code for https://www.jhusga.org/ is ${code}.`,
            `It will expire in ${minutes} minutes.`,
            "",
            "Do not share this code with anyone.",
            "If you did not ask for this, nothing has happened and you can ignore it.",
        ].join("\n"),
        html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your sign-in code</title></head>
<body style="margin:0;padding:0;background-color:#f2f6fa;color:#16365e;font-family:'Work Sans',Tahoma,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f6fa;">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #dbe4ed;border-top:4px solid #002d72;border-radius:6px;">
<tr><td style="padding:28px 24px 0;">
<a href="https://www.jhusga.org/" style="color:#002d72;text-decoration:none;"><img src="https://www.jhusga.org/logo.png" width="64" alt="SGA at JHU" style="display:block;width:64px;height:auto;border:0;"></a>
<p style="margin:16px 0 0;color:#002d72;font-size:16px;font-weight:600;">SGA at JHU</p>
<h1 style="margin:12px 0 0;color:#002d72;font-family:'Source Serif 4',Georgia,serif;font-size:30px;line-height:1.2;font-weight:600;">Your sign-in code</h1>
</td></tr>
<tr><td style="padding:20px 24px 0;font-size:18px;line-height:1.6;">
<p style="margin:0;">Your sign-in code for <a href="https://www.jhusga.org/" style="color:#164f87;text-decoration:underline;">jhusga.org</a> is:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
<tr><td align="center" style="padding:18px 12px;background-color:#eaf3fb;border:1px solid #b4c3d1;border-radius:4px;color:#002d72;font-family:Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:6px;line-height:1.3;">${code}</td></tr>
</table>
<p style="margin:20px 0 0;">It will expire in ${minutes} minutes.</p>
<p style="margin:16px 0 0;"><strong>Do not share this code with anyone.</strong></p>
</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.6;color:#52677d;">
<p style="margin:0;padding-top:20px;border-top:1px solid #dbe4ed;">If you did not ask for this, nothing has happened and you can ignore it.</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`,
    };
}
