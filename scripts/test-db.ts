import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function testConnection() {
    try {
        console.log('Connecting to database...');
        // Mask URL for safety in logs
        const maskedUrl = process.env.DATABASE_URL ?
            process.env.DATABASE_URL.replace(/:[^:@]*@/, ':****@') : 'undefined';
        console.log(`URL: ${maskedUrl}`);

        await client.connect();
        console.log('Connected successfully!');

        // Check users
        const usersRes = await client.query('SELECT COUNT(*) FROM users');
        console.log('User count:', usersRes.rows[0].count);

        if (parseInt(usersRes.rows[0].count) > 0) {
            const sampleUser = await client.query('SELECT * FROM users LIMIT 1');
            console.log('Sample user:', sampleUser.rows[0]);
        } else {
            console.log('No users found.');
        }

        await client.end();
        process.exit(0);
    } catch (err) {
        console.error('Connection failed:', err);
        process.exit(1);
    }
}

testConnection();
