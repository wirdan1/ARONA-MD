let handler = async (m, { conn, usedPrefix, command, text }) => {
    let parts = text.split(' ')
    let hari = parseInt(parts[0])
    let targetText = parts.slice(1).join(' ')
    
    if (!hari || isNaN(hari) || hari < 1) {
        return conn.sendMessage(m.chat, { 
            text: `Format salah!\nContoh:\n${usedPrefix + command} 30\n${usedPrefix + command} 7 @user\n${usedPrefix + command} 365 6281234567890` 
        }, { quoted: m })
    }

    let who
    
    if (m.quoted) {
        who = m.quoted.sender
    } else if (targetText && targetText.includes('@')) {
        who = targetText.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
    } else if (targetText && targetText.replace(/[^0-9]/g, '').length >= 10) {
        let nomor = targetText.replace(/[^0-9]/g, '')
        who = nomor + '@s.whatsapp.net'
    } else {
        who = m.sender
    }

    if (!global.db.data.users[who]) {
        global.db.data.users[who] = {
            name: await conn.getName(who) || "Unknown",
            limit: 10,
            exp: 0,
            level: 0,
            register: false,
            premium: false,
            banned: false,
            premiumTime: 0,
            lastLimitUpdate: new Date().toISOString()
        }
    }

    let user = global.db.data.users[who]
    let nama = await conn.getName(who)
    let isPremiumBefore = user.premium && user.premiumTime > Date.now()
    
    let sekarang = Date.now()
    let tambahWaktu = hari * 24 * 60 * 60 * 1000
    
    let premiumTimeBaru = isPremiumBefore ? 
        Math.max(user.premiumTime, sekarang) + tambahWaktu : 
        sekarang + tambahWaktu

    user.premium = true
    user.premiumTime = premiumTimeBaru
    user.limit = Infinity

    let tanggalAktif = new Date(premiumTimeBaru).toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })

    let message = 
`PREMIUM BERHASIL DITAMBAH

User : @${who.split('@')[0]}
Nama : ${nama}
Status : Premium User
Durasi : ${hari} hari
Berlaku sampai : ${tanggalAktif}
Limit : Unlimited

${isPremiumBefore ? 
'Perpanjangan premium berhasil!' : 
'Selamat! Sekarang kamu premium user!'}

Nikmati fitur unlimited limit!`

    conn.sendMessage(m.chat, { 
        text: message, 
        mentions: [who] 
    }, { quoted: m })
}

handler.help = ['addprem <hari> (@tag/reply/nomor)']
handler.tags = ['owner']
handler.command = /^(addprem|addpremium|tambahprem|premium)$/i
handler.owner = true

export default handler
