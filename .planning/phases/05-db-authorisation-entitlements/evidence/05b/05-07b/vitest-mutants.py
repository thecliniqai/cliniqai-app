# usage: mutate.py <name>  -- applies one source mutant in /Users/sid/Code/clinicOS (backup kept next to this script)
import sys, shutil, os
R='/Users/sid/Code/clinicOS/'
D=os.path.dirname(os.path.abspath(__file__))
M={
 'handler-unregistered': ('lib/jobs/internal/handlers/email-invite.ts',
   'export const EMAIL_INVITE_HANDLERS = {\n  [EMAIL_INVITE_KIND]: createEmailInviteHandler() as JobHandler<unknown>,\n};',
   'export const EMAIL_INVITE_HANDLERS = {} as Record<string, JobHandler<unknown>>;'),
 'handler-any-version': ('lib/jobs/internal/handlers/email-invite.ts',
   '        invitation.token_version !== payload.token_version ||\n', ''),
 'handler-any-version-b': ('lib/jobs/internal/handlers/email-invite.ts',
   '        p_token_version: payload.token_version,', '        p_token_version: invitation.token_version,'),
 'flow-no-turnstile': ('features/auth/invite-flows.ts',
   '  if (!verified.ok) {', '  if (!verified.ok && false) {'),
 'flow-pwned-after-redeem': ('features/auth/invite-flows.ts',
   '  if ((await (deps.checkPwned ?? ((p: string) => isPwnedPassword(p)))(password)) === "pwned") {',
   '  const early = await (deps.redeem ?? redeemInvitationWithPassword)(tokenHash, password);\n  if (early.ok && (await (deps.checkPwned ?? ((p: string) => isPwnedPassword(p)))(password)) === "pwned") {'),
 'system-overwrite-confirmed': ('features/auth/system.ts',
   '  if (ctx.user_id !== null && ctx.email_confirmed) return { ok: false, code: "account_exists" };\n', ''),
 'turnstile-fail-open': ('lib/auth/turnstile.ts',
   '    return fail(controller.signal.aborted ? "timeout" : "unavailable");', '    return { ok: true };'),
 'turnstile-skip-unset': ('lib/auth/turnstile.ts',
   '  if (!secret) return fail("unconfigured");', '  if (!secret) return { ok: true };'),
}
name=sys.argv[1]
if name=='restore':
    for f in set(v[0] for v in M.values()):
        b=os.path.join(D, f.replace('/','__')+'.orig')
        if os.path.exists(b): shutil.copy(b, R+f); os.remove(b)
    sys.exit(0)
f,a,b=M[name]
bk=os.path.join(D, f.replace('/','__')+'.orig')
if not os.path.exists(bk): shutil.copy(R+f, bk)
s=open(R+f).read()
assert a in s, name
open(R+f,'w').write(s.replace(a,b,1))
if name=='handler-any-version':
    s=open(R+f).read(); a2,b2=M['handler-any-version-b'][1:]; assert a2 in s; open(R+f,'w').write(s.replace(a2,b2,1))
