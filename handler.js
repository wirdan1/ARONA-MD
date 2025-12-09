/* 
Warning! Warning!
Jangan di ganti cr ini bos
© danz-xyz + Hookrest
api free : hookrest.my.id
owner : 62895323195263 [ Danz × Hookrest ]
*/

import "./settings.js";
import { smsg } from "./function/simple.js";
import { fileURLToPath } from "url";
import path from "path";
import { format } from "util";
import { unwatchFile, watchFile } from "fs";
import chalk from "chalk";
import { jidNormalizedUser, delay as baileysDelay } from "baileys";

const isNumber = x => typeof x === "number" && !isNaN(x);
const printMessages = (await import("./function/print.js")).default;

// RATE LIMIT MANAGER
class RateLimitManager {
    constructor() {
        this.lastRequest = {};
        this.queue = new Map();
        this.globalDelay = 1500; // Delay minimal antar request
    }

    async waitForTurn(jid, type = 'message') {
        const key = `${jid}_${type}`;
        const now = Date.now();
        
        if (this.lastRequest[key]) {
            const timeSinceLast = now - this.lastRequest[key];
            if (timeSinceLast < this.globalDelay) {
                const waitTime = this.globalDelay - timeSinceLast;
                await this.delay(waitTime + Math.random() * 500); // Tambah random delay
            }
        }
        
        this.lastRequest[key] = Date.now();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const rateLimitManager = new RateLimitManager();

function getBotJid(conn) {
    if (!conn || !conn.user) return "";
    if (conn.user.id) return jidNormalizedUser(conn.user.id);
    if (conn.user.jid) return conn.user.jid;
    return "";
}

// SISTEM LIMIT BARU - TANPA RESET HARIAN
class LimitSystem {
    constructor() {
        this.dailyResetHour = 0; // Jam reset (00:00)
    }

    // Cek apakah user perlu reset limit
    needsDailyReset(user) {
        if (!user || !user.lastLimitUpdate) return true;
        
        const now = new Date();
        const lastUpdate = new Date(user.lastLimitUpdate);
        
        // Reset hanya jika sudah lewat hari baru (00:00 WIB)
        return now.getDate() !== lastUpdate.getDate() && 
               now.getHours() >= this.dailyResetHour;
    }

    // Update limit user
    updateUserLimit(user, isPremium) {
        if (!user) return;
        
        const now = new Date();
        
        if (this.needsDailyReset(user)) {
            // HANYA user biasa yang direset, premium tetap unlimited
            if (!isPremium && user.limit !== Infinity && user.limit !== -1) {
                // Reset ke default (10) atau tetap dengan sisa sebelumnya
                if (user.limit < 10) {
                    user.limit = 10;
                }
            }
            user.lastLimitUpdate = now.toISOString();
        }
    }

    // Kurangi limit untuk user biasa
    useLimit(user, amount = 1) {
        if (!user || user.limit === Infinity || user.limit === -1) {
            return true; // Unlimited users always have limit
        }
        
        if (user.limit >= amount) {
            user.limit -= amount;
            user.lastLimitUpdate = new Date().toISOString();
            return true;
        }
        return false;
    }

    // Tambah limit (untuk owner/admin)
    addLimit(user, amount = 1) {
        if (!user) return;
        if (user.limit === Infinity || user.limit === -1) return;
        
        user.limit += amount;
        user.lastLimitUpdate = new Date().toISOString();
    }
}

const limitSystem = new LimitSystem();

// DELAY FUNCTION YANG LEBIH AMAN
async function safeDelay(ms) {
    return new Promise(resolve => {
        // Jangan delay lebih dari 10 detik
        const safeMs = Math.min(ms, 10000);
        setTimeout(resolve, safeMs);
    });
}

// SEND MESSAGE DENGAN RATE LIMIT PROTECTION
async function sendMessageWithProtection(conn, jid, content, options = {}, type = 'message') {
    try {
        // Tunggu giliran untuk mencegah rate limit
        await rateLimitManager.waitForTurn(jid, type);
        
        // Tambah delay random untuk distribusi request
        await safeDelay(500 + Math.random() * 1000);
        
        const result = await conn.sendMessage(jid, content, options);
        
        // Delay setelah kirim pesan
        await safeDelay(1000);
        
        return result;
    } catch (error) {
        console.error('[SEND MESSAGE ERROR]', error);
        
        // Jika error rate limit, tunggu lebih lama
        if (error.message?.includes('rate-overlimit') || error.message?.includes('429')) {
            console.log('[RATE LIMIT DETECTED] Waiting 30 seconds...');
            await safeDelay(30000); // Tunggu 30 detik
        }
        throw error;
    }
}

// GROUP METADATA DENGAN CACHE DAN PROTECTION
async function getGroupMetadataWithCache(conn, chatId) {
    try {
        // Cek cache dulu
        if (conn.chats?.[chatId]?.metadata) {
            return conn.chats[chatId].metadata;
        }
        
        // Delay sebelum fetch metadata
        await safeDelay(1000 + Math.random() * 2000);
        
        // Gunakan rate limit protection
        await rateLimitManager.waitForTurn(chatId, 'metadata');
        
        const metadata = await conn.groupMetadata(chatId).catch(() => ({}));
        
        // Simpan ke cache
        if (!conn.chats) conn.chats = {};
        if (!conn.chats[chatId]) conn.chats[chatId] = {};
        conn.chats[chatId].metadata = metadata;
        
        return metadata;
    } catch (error) {
        console.error('[GROUP METADATA ERROR]', error);
        return {};
    }
}

export async function handler(chatUpdate) {
    if (!chatUpdate) return;

    this.pushMessage?.(chatUpdate.messages).catch(console.error);
    let m = chatUpdate.messages[chatUpdate.messages.length - 1];
    if (!m) return;

    try {
        m = (await smsg(this, m)) || m;
        if (m.sender.endsWith("@broadcast")) return;
        if (m?.msg?.contextInfo?.mentionedJid?.length) {
            if (!this.storeMentions) this.storeMentions = {};
            const jidMentions = [...new Set(m.msg.contextInfo.mentionedJid.map(jid => this.getLid?.(jid) || jid))];
            this.storeMentions[m.id] = jidMentions;
        }
        if (m.isBaileys) return;

        const decodedOwnLid = await Promise.all(global.owner.map(o => this.getLidPN?.(`${o.replace(/[^0-9]/g, "")}@s.whatsapp.net`) || `${o.replace(/[^0-9]/g, "")}@s.whatsapp.net`));
        const isOwner = decodedOwnLid.includes(m.sender) || m.fromMe;
        
        if (global.opts["self"] && !isOwner) return;

        const botJid = getBotJid(this);

        try {
            if (global.db.data == null) await global.loadDatabase();

            // USER DATABASE
            let user = global.db.data.users[m.sender];
            if (typeof user !== "object") global.db.data.users[m.sender] = {};
            if (user) {
                if (!("name" in user)) user.name = m.name;
                if (!isNumber(user.age)) user.age = -1;
                if (!isNumber(user.level)) user.level = 0;
                if (!isNumber(user.exp)) user.exp = 0;
                
                // INISIALISASI DAN UPDATE LIMIT DENGAN SISTEM BARU
                const isPremiumActive = user.premium && user.premiumTime > Date.now();
                
                if (!isNumber(user.limit)) {
                    user.limit = isPremiumActive ? Infinity : 10;
                }
                
                // Update limit berdasarkan sistem baru
                limitSystem.updateUserLimit(user, isPremiumActive);
                
                if (!("afk" in user)) user.afk = false;
                if (!("afkReason" in user)) user.afkReason = "";
                if (!("register" in user)) user.register = false;
                if (!("premium" in user)) user.premium = false;
                if (!("banned" in user)) user.banned = false;
                if (!isNumber(user.afkTime)) user.afkTime = -1;
                if (!isNumber(user.regTime)) user.regTime = -1;
                if (!isNumber(user.premiumTime)) user.premiumTime = 0;
                if (!isNumber(user.premiumDate)) user.premiumDate = -1;
                if (!isNumber(user.bannedDate)) user.bannedDate = -1;
                
                // Tambah field baru untuk tracking
                if (!("lastLimitUpdate" in user)) {
                    user.lastLimitUpdate = new Date().toISOString();
                }
            } else {
                global.db.data.users[m.sender] = {
                    name: m.name || "User", 
                    age: -1, 
                    level: 0, 
                    exp: 0, 
                    limit: 10, // Default untuk user baru
                    afk: false, 
                    afkReason: "", 
                    register: false, 
                    premium: false, 
                    banned: false,
                    afkTime: -1, 
                    regTime: -1, 
                    premiumTime: 0, 
                    premiumDate: -1, 
                    bannedDate: -1,
                    lastLimitUpdate: new Date().toISOString()
                };
            }

            // GROUP DATABASE (sama seperti sebelumnya)
            if (m.isGroup) {
                let chat = global.db.data.chats[m.chat];
                if (typeof chat !== "object") global.db.data.chats[m.chat] = {};
                if (chat) {
                    if (!("antispam" in chat)) chat.antispam = false;
                    if (!("antilink" in chat)) chat.antilink = false;
                    if (!("antivirtex" in chat)) chat.antivirtex = false;
                    if (!("mute" in chat)) chat.mute = false;
                    if (!("detect" in chat)) chat.detect = true;
                    if (!("sambutan" in chat)) chat.sambutan = true;
                    if (!("sewa" in chat)) chat.sewa = false;
                    if (!("sWelcome" in chat)) chat.sWelcome = "";
                    if (!("sBye" in chat)) chat.sBye = "";
                    if (!("sPromote" in chat)) chat.sPromote = "";
                    if (!("sDemote" in chat)) chat.sDemote = "";
                    if (!isNumber(chat.sewaDate)) chat.sewaDate = -1;
                } else {
                    global.db.data.chats[m.chat] = {
                        antispam: false, antilink: false, antivirtex: false, mute: false,
                        detect: true, sambutan: true, sewa: false,
                        sWelcome: "", sBye: "", sPromote: "", sDemote: "", sewaDate: -1
                    };
                }
            }

            // BOT SETTINGS
            let setting = global.db.data.settings[botJid];
            if (typeof setting !== "object") global.db.data.settings[botJid] = {};
            if (setting) {
                if (!("chatMode" in setting)) setting.chatMode = "";
                if (!("antispam" in setting)) setting.antispam = true;
                if (!("autoread" in setting)) setting.autoread = false;
                if (!("autobackup" in setting)) setting.autobackup = true;
                if (!isNumber(setting.backupDate)) setting.backupDate = -1;
            } else {
                global.db.data.settings[botJid] = {
                    chatMode: "", antispam: true, autoread: false, autobackup: true, backupDate: -1
                };
            }
        } catch (error) {
            console.log('[DB ERROR]', error);
        }

        if (typeof m.text !== "string") m.text = "";

        const isROwner = decodedOwnLid.includes(m.sender) || (botJid && m.sender === botJid);
        let usedPrefix;

        let groupMetadata = {};
        if (m.isGroup) {
            try {
                // Gunakan fungsi yang sudah dilindungi rate limit
                groupMetadata = await getGroupMetadataWithCache(this, m.chat);
            } catch (e) {
                console.log("[GROUP METADATA FETCH FAILED]", e);
                groupMetadata = {};
            }
        }

        const participants = m.isGroup ? groupMetadata.participants || [] : [];
        const user = m.isGroup ? participants.find(u => u.id === m.sender) : {};
        const bot = m.isGroup ? participants.find(u => u.id === botJid) : {};
        const isRAdmin = user?.admin === "superadmin" || false;
        const isAdmin = isRAdmin || user?.admin === "admin" || false;
        const isBotAdmin = bot?.admin || false;

        const isRegister = global.db.data?.users[m.sender]?.register === true;
        const isPremium = global.db.data?.users[m.sender]?.premium === true && global.db.data.users[m.sender]?.premiumTime > Date.now();
        const isBannned = global.db.data?.users[m.sender]?.banned === true;
        const isMuted = m.isGroup && global.db.data?.chats[m.chat]?.mute === true;
        const isSewa = m.isGroup && global.db.data?.chats[m.chat]?.sewa === true;
        const chatMode = global.db.data?.settings[botJid]?.chatMode;

        if ((chatMode === "pconly" || global.opts["pconly"]) && !isPremium && !isOwner && m.isGroup) return;
        if ((chatMode === "gconly" || global.opts["gconly"]) && !isPremium && !isOwner && !m.isGroup) return;
        if ((chatMode === "sewaonly" || global.opts["sewaonly"]) && !isPremium && !isOwner && !isSewa && m.isGroup) return;

        const ___dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), "./plugins");
        for (let name in global.plugins) {
            let plugin = global.plugins[name];
            if (!plugin || plugin?.disable) continue;

            const __filename = path.join(___dirname, name);
            const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
            let _prefix = plugin.customPrefix ? plugin.customPrefix : global.prefix;
            let match = (
                _prefix instanceof RegExp ? [[_prefix.exec(m.text), _prefix]]
                : Array.isArray(_prefix) ? _prefix.map(p => {
                    let re = p instanceof RegExp ? p : new RegExp(str2Regex(p));
                    return [re.exec(m.text), re];
                })
                : typeof _prefix === "string" ? [[new RegExp(str2Regex(_prefix)).exec(m.text), new RegExp(str2Regex(_prefix))]]
                : [[[], new RegExp()]]
            ).find(p => p[1]);

            if (typeof plugin.before === "function") {
                if (await plugin.before.call(this, m, { match, conn: this, participants, groupMetadata, user, bot, isROwner, isOwner, isRAdmin, isAdmin, isBotAdmin, isPremium, isBannned, isMuted, isRegister, isSewa, chatUpdate, __dirname, __filename })) continue;
            }
            if (typeof plugin !== "function") continue;

            if ((usedPrefix = (match[0] || "")[0])) {
                let noPrefix = m.text.replace(usedPrefix, "");
                let [command, ...args] = noPrefix.trim().split(` `).filter(v => v);
                args = args || [];
                let _args = noPrefix.trim().split(` `).slice(1);
                let text = _args.join(` `);
                command = (command || "").toLowerCase();
                let isAccept = plugin.command instanceof RegExp ? plugin.command.test(command) :
                               Array.isArray(plugin.command) ? plugin.command.some(cmd => (cmd instanceof RegExp ? cmd.test(command) : cmd === command)) :
                               typeof plugin.command === "string" ? plugin.command === command : false;

                if (!isAccept) continue;
                m.plugin = name;

                if (isMuted && !isROwner && !isAdmin) return;
                if (isBannned && !isROwner && !isOwner) return;

                if (plugin.rowner && !isROwner) { global.dFail("rowner", m, this); continue; }
                if (plugin.owner && !isOwner) { global.dFail("owner", m, this); continue; }
                if (plugin.premium && !isPremium) { global.dFail("premium", m, this); continue; }
                if (plugin.group && !m.isGroup) { global.dFail("group", m, this); continue; }
                if (plugin.botAdmin && !isBotAdmin) { global.dFail("botAdmin", m, this); continue; }
                if (plugin.admin && !isAdmin) { global.dFail("admin", m, this); continue; }
                if (plugin.private && m.isGroup) { global.dFail("private", m, this); continue; }
                if (plugin.register && !isRegister) { global.dFail("unreg", m, this); continue; }
                if (plugin.restrict) { global.dFail("restrict", m, this); continue; }

                m.isCommand = true;

                // SISTEM LIMIT BARU YANG LEBIH BAIK
                let limitUsed = false;
                let limitCost = 0;
                
                if (plugin.limit) {
                    limitCost = typeof plugin.limit === "number" ? plugin.limit : 1;
                    const userData = global.db.data.users[m.sender];
                    
                    // PREMIUM USER: Unlimited access
                    if (isPremium) {
                        limitUsed = false; // Tidak pakai limit
                    } 
                    // USER BIASA: Cek limit dengan sistem baru
                    else {
                        const hasEnoughLimit = limitSystem.useLimit(userData, limitCost);
                        
                        if (!hasEnoughLimit) {
                            const remaining = userData.limit || 0;
                            const resetTime = userData.lastLimitUpdate ? 
                                new Date(userData.lastLimitUpdate).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) : 
                                "00:00";
                            
                            await sendMessageWithProtection(this, m.chat, 
`> *LIMIT HABIS!*

Sisa limit kamu: *${remaining}*

Limit akan bertambah otomatis tiap hari.
Terakhir update: ${resetTime}

*Fitur premium:* Limit tidak terbatas!`, 
                            m);
                            continue; // Block penggunaan fitur
                        }
                        limitUsed = true;
                    }
                }

                let extra = { 
                    match, 
                    conn: this, 
                    usedPrefix, 
                    noPrefix, 
                    _args, 
                    args, 
                    command, 
                    text, 
                    participants, 
                    groupMetadata, 
                    user, 
                    bot, 
                    isROwner, 
                    isOwner, 
                    isRAdmin, 
                    isAdmin, 
                    isBotAdmin, 
                    isPremium, 
                    isBannned, 
                    isMuted, 
                    isRegister, 
                    isSewa, 
                    chatUpdate, 
                    __dirname, 
                    __filename,
                    sendMessageWithProtection // Tambah fungsi protected ke extra
                };

                try {
                    // Delay sebelum eksekusi untuk hindari rate limit
                    await safeDelay(300 + Math.random() * 700);
                    
                    // Eksekusi plugin
                    await plugin.call(this, m, extra);
                } catch (e) {
                    console.log('[PLUGIN ERROR]', e);
                    const text = format(e);
                    if (e.name && decodedOwnLid[0]) {
                        let msg = `*『 ERROR MESSAGE 』*\n*PLUGIN:* ${m.plugin}\n*SENDER:* ${m.sender}\n*CHAT:* ${m.chat}\n*COMMAND:* ${usedPrefix + command}\n*ERROR:*\n${text}`;
                        await sendMessageWithProtection(this, decodedOwnLid[0], msg);
                    }
                } finally {
                    // NOTIFIKASI LIMIT (hanya untuk user biasa)
                    if (plugin.limit && limitUsed && !isPremium) {
                        const currentLimit = global.db.data.users[m.sender].limit;
                        await sendMessageWithProtection(this, m.chat, 
`> *Command berhasil digunakan*
Limit berkurang: *${limitCost}
Sisa limit: *${currentLimit}
Upgrade premium untuk limit tak terbatas!`, 
                        m);
                    }
                    
                    // NOTIFIKASI PREMIUM USER
                    if (plugin.limit && isPremium) {
                        await sendMessageWithProtection(this, m.chat, 
`> *PREMIUM USER ACCESS*
Limit tidak berkurang - Unlimited access!`, 
                        m);
                    }

                    if (typeof plugin.after === "function") {
                        try { 
                            await plugin.after.call(this, m, extra); 
                        } catch (error) { 
                            console.log('[PLUGIN AFTER ERROR]', error); 
                        }
                    }
                }
                break;
            }
        }
    } catch (error) {
        console.log('[HANDLER ERROR]', error);
    } finally {
        try { 
            await printMessages(m, this); 
        } catch (e) { 
            console.log('[PRINT MESSAGE ERROR]', e); 
        }
    }
}

// Fungsi participantsUpdate dan groupsUpdate yang sudah dimodifikasi
export async function participantsUpdate({ id, participants, action }) {
    try {
        if (this.isHandlerInit) return;
        let chat = global.db.data?.chats[id] || {};

        let message;
        switch (action) {
            case "add":
            case "remove":
                if (chat?.sambutan) {
                    await safeDelay(3000); // Delay awal lebih lama
                    
                    // Gunakan fungsi protected untuk get metadata
                    let groupMetadata = await getGroupMetadataWithCache(this, id);
                    
                    // Jika banyak peserta, delay lebih lama
                    const baseDelay = participants.length > 3 ? 4000 : 2000;
                    
                    for (let user of participants) {
                        let lid = (user?.id || "").toString();
                        if (!lid || lid.endsWith("@g.us")) continue;
                        if (lid.endsWith("@s.whatsapp.net")) lid = await this.getLidPN?.(lid) || lid;

                        message = (action === "add"
                            ? (chat.sWelcome || this.sWelcome || "Selamat Datang @user")
                                  .replace("@subject", await this.getName(id))
                                  .replace("@desc", groupMetadata.desc ? String.fromCharCode(8206).repeat(4001) + groupMetadata.desc : "")
                            : chat.sBye || this.sBye || "Selamat Tinggal @user"
                        ).replace("@user", "@" + lid.split("@")[0]);

                        try {
                            await sendMessageWithProtection(this, id, { 
                                text: message, 
                                contextInfo: { mentionedJid: [lid] }
                            }, {}, baseDelay);
                        } catch (e) {
                            console.log('[WELCOME/BYE ERROR]', e);
                        }
                        
                        // Extra delay untuk multiple participants
                        if (participants.length > 1) {
                            await safeDelay(1000);
                        }
                    }
                }
                break;

            case "promote":
            case "demote":
                if (chat?.detect) {
                    for (let user of participants) {
                        let lid = (user?.id || "").toString();
                        if (!lid || lid.endsWith("@g.us")) continue;
                        if (lid.endsWith("@s.whatsapp.net")) lid = await this.getLidPN?.(lid) || lid;
                        
                        message = (action === "promote"
                            ? chat.sPromote || this.sPromote || "Selamat @user telah menjadi Admin"
                            : chat.sDemote || this.sDemote || "@user telah diberhentikan sebagai Admin"
                        ).replace("@user", "@" + lid.split("@")[0]);

                        await sendMessageWithProtection(this, id, { 
                            text: message, 
                            contextInfo: { mentionedJid: [lid] }
                        }, {}, 3000);
                    }
                }
                break;
        }
    } catch (e) {
        console.error('[PARTICIPANTS UPDATE ERROR]', e);
    }
}

export async function groupsUpdate(groupsUpdate) {
    try {
        if (!groupsUpdate) return;
        
        for (const groupUpdate of groupsUpdate) {
            const id = groupUpdate.id;
            if (!id) continue;
            
            let text = "";
            const chat = global.db.data?.chats[id];
            if (!chat?.detect) continue;

            await safeDelay(2000); // Delay sebelum proses

            if (groupUpdate?.author) {
                let user = (groupUpdate?.author || "").toString();
                if (user?.endsWith("@s.whatsapp.net")) user = await this.getLidPN?.(user) || user;

                if (groupUpdate.desc && user) text = (chat?.sDesc || "*Deskripsi group diganti oleh* @user\n\n@desc").replace("@user", `@${user.split("@")[0]}`).replace("@desc", groupUpdate.desc);
                if (groupUpdate.subject && user) text = (chat?.sSubject || "*Judul group diganti oleh* @user\n\n@subject").replace("@user", `@${user.split("@")[0]}`).replace("@subject", groupUpdate.subject);
                if (groupUpdate.inviteCode && user) text = "*Link group diganti oleh* @user".replace("@user", `@${user.split("@")[0]}`);
                if (!text) continue;
                
                await sendMessageWithProtection(this, id, { text, mentions: [user] }, {}, 3000);
            }
            
            if (groupUpdate.icon) {
                await safeDelay(3000);
                await sendMessageWithProtection(this, id, "*Ikon group telah diganti*", {});
            }
        }
    } catch (e) {
        console.error('[GROUPS UPDATE ERROR]', e);
    }
}

export async function catchDeleted(message) {
    try {
        if (!message) return;
    } catch (error) {
        console.error(error);
    }
}

global.dFail = (type, m, conn) => {
    let msg = {
        rowner: "*ᴅᴇᴠᴇʟᴏᴘᴇʀ ᴏɴʟʏ*", owner: "*ᴏᴡɴᴇʀ ᴏɴʟʏ*", premium: "*ᴘʀᴇᴍɪᴜᴍ ᴏɴʟʏ*",
        group: "*ɢʀᴏᴜᴘ ᴄʜᴀᴛ ᴏɴʟʏ*", private: "*ᴘʀɪᴠᴀᴛᴇ ᴄʜᴀᴛ ᴏɴʟʏ*", admin: "*ᴀᴅᴍɪɴ ᴏɴʟʏ*",
        botAdmin: "*ʙᴏᴛ ᴀᴅᴍɪɴ ʀᴇǫᴜɪʀᴇᴅ*", sewa: "*ᴘᴀɪᴅ ɢʀᴏᴜᴘ ᴏɴʟʏ*", unreg: "*ʏᴏᴜ ᴀʀᴇ ɴᴏᴛ ʀᴇɢɪsᴛᴇʀᴇᴅ*",
        restrict: "*ʀᴇsᴛʀɪᴄᴛᴇᴅ ᴄᴏᴍᴍᴀɴᴅ*", disable: "*ᴅɪsᴀʙʟᴇ ᴄᴏᴍᴍᴀɴᴅ*"
    }[type];
    if (msg) return conn.reply(m.chat, msg, m);
};

// HOT RELOAD
let file = fileURLToPath(import.meta.url);
watchFile(file, () => {
    unwatchFile(file);
    console.log(`${chalk.white.bold(" [ HOOKREST SYSTEM ]")} ${chalk.green.bold(`FILE DIUPDATE "handler.js"`)}`);
    import(`${file}?update=${Date.now()}`).catch(console.error);
});

export default handler;
