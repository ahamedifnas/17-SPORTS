import fs from 'node:fs'
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8')))
edit('src/services/businessService.ts',s=>{
 const a=s.indexOf('export const expenseService ='),b=s.indexOf('function callable',a)
 return s.slice(0,a)+`export const expenseService = {
  list: (branchId: string) => branchList<Expense>('expenses', branchId),
  async save(input: Omit<Expense, 'id' | 'branchId'> & { id?: string }, user: UserProfile) {
    if(!user.uid)throw new Error('Sign in required.')
    const result=await callable<Record<string,unknown>,{id:string}>('saveExpense',sanitizeFirestoreData({...input,id:input.id||crypto.randomUUID()}));return result.id
  },
  async archive(id:string,_number:string,user:UserProfile){if(!user.uid)throw new Error('Sign in required.');await callable('saveExpense',{id,archive:true})},
}

`+s.slice(b)
})
// Keep credit issuance and financial opening balances out of cashier profile writes.
edit('firestore.rules',s=>s.replace("allow create: if (management() || cashier() || accountant()) && sameBranch(request.resource.data);", "allow create: if (management() || cashier() || accountant()) && sameBranch(request.resource.data) && (financeStaff() || (request.resource.data.currentCredit == 0 && request.resource.data.currentBalance == 0 && request.resource.data.openingBalance == 0 && request.resource.data.creditLimit == 0));").replace("['currentBalance','currentCredit','openingBalance']", "['currentBalance','currentCredit','openingBalance']").replace("&& !request.resource.data.diff(resource.data).affectedKeys().hasAny(['currentBalance','currentCredit','openingBalance']);", "&& !request.resource.data.diff(resource.data).affectedKeys().hasAny(['currentBalance','currentCredit','openingBalance']) && (financeStaff() || !request.resource.data.diff(resource.data).affectedKeys().hasAny(['creditLimit']));"))
edit('src/pages/ProductFormPage.tsx',s=>s.replace('type={type} step=',"disabled={Boolean(id)&&name==='stock'} type={type} step=").replace('Prices are stored accurately and stock changes remain traceable.','Change existing stock through Inventory adjustments. Product edits preserve recorded stock and average cost.').replace('type="number" placeholder="Stock"','disabled={Boolean(id)} type="number" placeholder="Opening stock"'))
edit('src/pages/PartiesPage.tsx',s=>s.replace('className="mt-2" type={key',"disabled={(Boolean(editing)&&key==='opening')||(profile?.role==='cashier'&&(key==='opening'||key==='limit'))} className=\"mt-2\" type={key"))
edit('src/pages/FinancePages.tsx',s=>s.replace("const methods: PaymentMethod[] = ['cash', 'card', 'bank', 'qr', 'credit']","const methods: PaymentMethod[] = ['cash', 'card', 'bank', 'qr']"))
edit('docs/UPGRADE-PLAN.md',s=>s.replace('13 Vitest source files/tests (verify actual test counts in the release report)','six existing Vitest test files'))
