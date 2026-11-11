import nodemailer from 'nodemailer'

let cachedTransporter

function getTransporter() {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const port = Number(process.env.SMTP_PORT || 465)
  const from = process.env.SMTP_FROM || user
  if (!host || !user || !pass || !from || !Number.isInteger(port)) {
    const error = new Error('邮件服务尚未配置。')
    error.statusCode = 503
    throw error
  }
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : port === 465,
      auth: { user, pass },
      // Keep auth email requests below Netlify's external proxy timeout.
      connectionTimeout: 6_000,
      greetingTimeout: 6_000,
      socketTimeout: 8_000,
    })
  }
  return { transporter: cachedTransporter, from }
}

export async function sendAuthEmail({ to, subject, heading, message, link, button }) {
  const { transporter, from } = getTransporter()
  const safeLink = link.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  await transporter.sendMail({
    from,
    to,
    subject,
    text: `${heading}\n\n${message}\n\n${link}\n\n如果这不是你发起的操作，可以忽略本邮件。`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.7;max-width:560px;margin:auto;color:#22384a"><h1>${heading}</h1><p>${message}</p><p><a href="${safeLink}" style="display:inline-block;padding:10px 18px;background:#24445b;color:white;text-decoration:none;border-radius:8px">${button}</a></p><p>如果按钮无法打开，请复制此链接到浏览器：<br><a href="${safeLink}">${safeLink}</a></p><p>如果这不是你发起的操作，可以忽略本邮件。</p></div>`,
  })
}
