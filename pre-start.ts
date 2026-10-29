import { appVersion, getGitMetadata } from './scripts/git-metadata.ts';

const meta = getGitMetadata();
const version = appVersion();

console.log(`
★═══════════════════════════════════════★
            G I T O P E N
         ⚡️  Welcome  ⚡️
★═══════════════════════════════════════★
`);
console.log('📍 Current Version Tag:', `v${version}`);
console.log('📍 Current Commit Version:', meta.commitHash);
console.log('  Please wait until the URL appears here');
console.log('★═══════════════════════════════════════★');
