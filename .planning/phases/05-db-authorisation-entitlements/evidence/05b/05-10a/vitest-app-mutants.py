import sys, shutil, os
R='/Users/sid/Code/clinicOS/'
D=os.path.dirname(os.path.abspath(__file__))
M={
 'guard-no-access': [('lib/permissions/guards.ts','  await assertTenantAccess(membership, access);\n','  void access;\n')],
 'context-no-access': [('lib/auth/context.ts','  await assertTenantAccess(membership, access);','  void access;')],
 'api-no-402': [('lib/api/auth.ts','  if (accessError || access !== "full") {','  if (accessError) {')],
 'storage-no-clamp': [('lib/storage/index.ts','expiresInSeconds: clampSignedUrlTtl(options.expiresInSeconds, options.purpose) });','expiresInSeconds: options.expiresInSeconds });'),
                      ('lib/storage/supabase-provider.ts','const expiresIn = clampSignedUrlTtl(options.expiresInSeconds, options.purpose);','const expiresIn = options.expiresInSeconds || 3600;')],
}
name=sys.argv[1]
files=set(f for v in M.values() for f,_,_ in v)
if name=='restore':
    for f in files:
        b=os.path.join(D, f.replace('/','__')+'.orig')
        if os.path.exists(b): shutil.copy(b, R+f); os.remove(b)
    sys.exit(0)
for f,a,b in M[name]:
    bk=os.path.join(D, f.replace('/','__')+'.orig')
    if not os.path.exists(bk): shutil.copy(R+f, bk)
    s=open(R+f).read(); assert a in s, (name,f); open(R+f,'w').write(s.replace(a,b,1))
