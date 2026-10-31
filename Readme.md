cd "D:\Prem'stuff\projects\scheduler"   # project root
npm install          # already done; runs the postinstall native check
npm run dev          # opens the app
npm run build        # production build into out/
npm run rebuild:electron   # only if the DB ever reports an ABI mismatch in dev
npm run rebuild:node       # before running plain-Node tests


cd "D:\Prem'stuff\projects\scheduler"
npm run dev