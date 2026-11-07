import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
    // 1. Only allow POST requests (form submissions)
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    try {
        // 2. Natively read Vercel's built-in parsed request body helper
        const { name, content } = req.body;

        // 3. Prevent crashing if data fields were submitted completely blank
        if (!name || !content) {
            return res.status(400).json({ success: false, error: 'Name and Content fields are required.' });
        }

        // 4. Inject the data cleanly into your entries table
        await sql`
            INSERT INTO entries (name, content) 
            VALUES (${name}, ${content});
        `;

        // 5. Respond with a clear success message to your HTML script
        return res.status(200).json({ success: true, message: 'Data saved successfully!' });

    } catch (error) {
        // Sends the exact internal error text back to the browser so you can read it
        return res.status(500).json({ success: false, error: error.message });
    }
}
