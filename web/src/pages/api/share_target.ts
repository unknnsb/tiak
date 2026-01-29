import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST' || req.method === 'GET') {
    const data = req.method === 'POST' ? req.body : req.query;
    const { title, text, url } = data;
    
    const combinedContent = `${title || ''} ${text || ''} ${url || ''}`;

    const urlMatch = combinedContent.match(/https?:\/\/[^\s]+/);
    const targetUrl = urlMatch ? urlMatch[0] : '';

    if (targetUrl) {
      res.redirect(303, `/?share_url=${encodeURIComponent(targetUrl)}`);
    } else {
      res.redirect(303, '/');
    }
  } else {
    res.status(405).end();
  }
}