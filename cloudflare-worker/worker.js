export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Handle form submissions
    if (request.method === 'POST') {
      try {
        const formData = await request.formData();
        const name = formData.get('name');
        const email = formData.get('email');
        const message = formData.get('message');

        // Basic validation
        if (!name || !email || !message) {
          return new Response(JSON.stringify({ error: 'All fields are required' }), {
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json',
            },
          });
        }

        // Create email content
        const emailContent = `New contact form submission:

Name: ${name}
Email: ${email}
Message: ${message}

Reply to: ${email}`;

        // Send email using a simple approach via your Cloudflare email routing
        // This will forward to your Gmail through your existing setup
        const emailResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/routing/addresses/hello@wileydigital.tech/forwards`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{
              to: [{ email: 'hello@wileydigital.tech' }],
              subject: `New contact from ${name}`,
            }],
            from: { email: 'noreply@wileydigital.tech' },
            content: [{
              type: 'text/plain',
              value: emailContent,
            }],
          }),
        });

        // For now, let's use a simpler approach with mailto or email service
        // Since Cloudflare Email API setup can be complex, let's use Resend or similar
        
        // Alternative: Use Resend API (simpler to set up)
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'contact@wileydigital.tech',
            to: ['hello@wileydigital.tech'],
            subject: `New contact from ${name}`,
            text: emailContent,
            html: `
              <h2>New Contact Form Submission</h2>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
              <p><strong>Message:</strong></p>
              <p>${message.replace(/\n/g, '<br>')}</p>
            `,
          }),
        });

        if (resendResponse.ok) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json',
            },
          });
        } else {
          const errorText = await resendResponse.text();
          console.error('Email send error:', errorText);
          return new Response(JSON.stringify({ error: 'Failed to send email' }), {
            status: 500,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'application/json',
            },
          });
        }

      } catch (error) {
        console.error('Worker error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          },
        });
      }
    }

    // Default response for GET requests
    return new Response('Wiley Digital Contact Form Handler - Ready to receive form submissions', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain',
      },
    });
  },
};
