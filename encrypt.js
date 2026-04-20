const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Default secret passphrase - this must match the one in index.html!
const SECRET_PASSPHRASE = 'NaxlexSecretKey2026!#';

function encryptFile(inputFile, outputFile) {
    if (!fs.existsSync(inputFile)) {
        console.error(`Error: File not found - ${inputFile}`);
        process.exit(1);
    }

    try {
        // Derive a 32-byte key from the passphrase using SHA-256
        const key = crypto.createHash('sha256').update(SECRET_PASSPHRASE).digest();
        
        // Generate a random 12-byte Initialization Vector (IV) for AES-GCM
        const iv = crypto.randomBytes(12);

        // Read the file contents and compress it
        const fileContent = fs.readFileSync(inputFile);
        const compressedContent = zlib.gzipSync(fileContent);

        // Create the cipher
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        // Encrypt the compressed content
        const encryptedContent = Buffer.concat([cipher.update(compressedContent), cipher.final()]);

        // Get the authentication tag (16 bytes)
        const authTag = cipher.getAuthTag();

        // The final file structure: [IV (12 bytes)] + [Encrypted Data] + [Auth Tag (16 bytes)]
        // This structure perfectly matches what the Web Crypto API expects for AES-GCM decryption.
        const finalBuffer = Buffer.concat([iv, encryptedContent, authTag]);

        // Write the output file
        fs.writeFileSync(outputFile, finalBuffer);
        
        console.log(`✅ Successfully encrypted:`);
        console.log(`   In:  ${inputFile}`);
        console.log(`   Out: ${outputFile}`);
        console.log(`\nYou can now drop ${outputFile} into the visualizer!`);
    } catch (err) {
        console.error('Encryption failed:', err.message);
    }
}

// Simple CLI handling
const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node encrypt.js <input-file.json> [output-file.naxenc]');
    process.exit(1);
}

const inputPath = args[0];
let outputPath = args[1];

if (!outputPath) {
    const parsedPath = path.parse(inputPath);
    outputPath = path.join(parsedPath.dir, `${parsedPath.name}.naxenc`);
}

encryptFile(inputPath, outputPath);
