import { readFileSync } from 'fs';
import { extractTable } from './services/tableExtractor.ts';

async function test() {
    const fileBuf = readFileSync('c:/Users/Philander/Downloads/Test accounts/202409-BankStatement-101111000-TymeBank-1.pdf');
    const file = new File([fileBuf], 'TymeBank.pdf', { type: 'application/pdf' });
    try {
        const table = await extractTable(file);
        console.log("Success?", table);
    } catch (err: any) {
        console.log("Error Caught:", err.message);
        if (err.message.includes('password-protected. Please provide the password')) {
            console.log("ALL GOOD! PROPER MESSAGE CAUGHT");
        } else {
            console.error("FAILED to catch the right message");
        }
    }
}
test();
