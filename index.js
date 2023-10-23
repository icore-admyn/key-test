const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { decodeSubjectChain, calculateNet, calculateGross } = require('relay-jwt');
const jwa = require('jwa');
const { default: axios } = require('axios');
require('dotenv').config();

const app = express();
const algorithm = 'ES256';
const ecdsa = jwa(algorithm);

// Serve static files (index.html)
app.use(express.static(path.join(__dirname)));

const requestInvoice = async (amount, url, key) => {
    const params = {
        merchant_addr: 'etoken:qqgvdfd7ef9vle67hftk9majy5ra2creq5kfs2ht3w',
        amount: amount,
        return_json: true,
    };
    const queryParams = Object.keys(params)
        .map((key) => {
            if (Array.isArray(params[key])) {
                return `${key}=${encodeURIComponent(JSON.stringify(params[key]))}`;
            }
            return `${key}=${encodeURIComponent(params[key])}`;
        })
        .join('&');
    const getUrl = `${url}?${queryParams}`;
    try {
        const response = await axios.get(getUrl, {
            headers: {
                'Authorization': `Bearer ${key}`
            }
        });
        const responseData = await response.data;
        const payURL = responseData.paymentUrl;
        return payURL;
    } catch (error) {
        console.error('Error:', error);
        return error;
    }

}

const getMerchantAmount = (target, rates, decimals = 1) => {
    const estimatedFeeFactor = rates.reduce((acc, rate) => acc * (1 + rate), 1) * 1.05;
    console.log("estimatedFeeFactor", estimatedFeeFactor);
    const rangeStart = +(target / (estimatedFeeFactor + 0.01)).toFixed(4);
    const rangeEnd = +(target / (estimatedFeeFactor - 0.01)).toFixed(4);
    console.log("range", rangeStart, rangeEnd);
    const step = 10 ** (-decimals);
    console.log("step", step);
    let merchantAmount;
    for (let m = rangeStart; m < rangeEnd; m = +(m + step).toFixed(4)) {
        const tokenAmount = rates.reduce((accumulator, rate) => +(accumulator * (1 + rate)).toFixed(4), m);
        const purchaseTokenAmount = +(Math.ceil(tokenAmount * 100) / 100).toFixed(2);
        const totalAmount = +(Number((purchaseTokenAmount * 1.01).toFixed(2)) + Number((Number((purchaseTokenAmount * 1.01).toFixed(2)) * 0.04).toFixed(2))).toFixed(2);
        console.log("m", m, "TA", totalAmount);

        if (totalAmount === target) {
            merchantAmount = m;
            break;
        }
    }

    console.log("merchantAmount", merchantAmount);

    return merchantAmount || getMerchantAmount(target, rates, decimals + 1);
}

const feeShifting = async (amount, url, key) => {
    const amountSantized = parseFloat(amount);

    try {
        if (key === undefined) {
            console.log('Key undefined')
            return amount; // If the key is empty, return the original amount
        }
        // Decode the provided key
        const decoded = jwt.decode(key);
        const decodedChain = decodeSubjectChain(decoded.sub, ecdsa.verify);
        const buxDecimals = 4;
        const badgerFixedFee = 0;
        const badgerVarFee = 0.0504;

        const getRates = () => {
            const array = [];
            decodedChain.forEach((obj) => {
                array.push(obj.amount / 1000);
            })
            return array;
        };
        const rates = getRates();

        const amountWithoutBadgerFees = (amount - badgerFixedFee) / (1 + badgerVarFee);
        const amountWithBadgerFees = ((1 + badgerVarFee) * amount) + badgerFixedFee;
        const netAmountForDollar = getMerchantAmount(amountSantized, rates);
        const grossAmountForDollar = +calculateGross(parseFloat(amount), decodedChain, buxDecimals).toFixed(4);
        const merchantPaysCheckoutFees = +calculateNet(parseFloat(amount), decodedChain, buxDecimals).toFixed(4);
        const userPaysAll = ((1 + badgerVarFee) * grossAmountForDollar) + badgerFixedFee;

        const userPaysAllURL = await requestInvoice(parseFloat(amount), url, key)
        const userPaysCheckoutFeeURL = await requestInvoice(merchantPaysCheckoutFees, url, key)
        const merchantPaysAllURL = await requestInvoice(netAmountForDollar, url, key)

        if (userPaysAllURL.status === 404) {
            const output = {
                error: `An error retreving the invoice: ${userPaysAllURL.message}`
            }
            return output;
        }

        const output = {
            userPaysAllInput: parseFloat(amount),
            userPaysAllOutput: userPaysAll.toFixed(4),
            userPaysAllURL: userPaysAllURL,
            userPaysCheckoutFeeInput: merchantPaysCheckoutFees,
            userPaysCheckoutFeeOutput: amountWithBadgerFees.toFixed(4),
            userPaysCheckoutFeeURL: userPaysCheckoutFeeURL,
            merchantPaysAllInput: netAmountForDollar,
            merchantPaysAllOutput: parseFloat(amount),
            merchantPaysAllURL: merchantPaysAllURL,
        }

        console.log(output)

        return output;
    } catch (error) {
        // Log an error message if decoding the key fails and return oringinal amount
        console.error("An error occurred decoding the key:", error);
        const output = {
            error: `An error occurred decoding the key: ${error}`
        }
        return output;
    }
};

app.get('/fee-shift', async (req, res) => {
    const { amount, url, key } = req.query;
    try {
        const feeShiftedAmount = await feeShifting(amount, url, key);
        res.json({ feeShiftedAmount });
    } catch (error) {
        console.log('Internal Server Error')
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Start the server
let server;

const PORT_HTTP = process.env.PORT || 80;
const PORT_HTTPS = 443;

if (process.env.SSL_CERTIFICATE && process.env.SSL_PRIVATE_KEY) {
    // HTTPS configuration if SSL certificate and private key are provided
    const https = require('https');
    const fs = require('fs');

    const options = {
        cert: fs.readFileSync(process.env.SSL_CERTIFICATE),
        key: fs.readFileSync(process.env.SSL_PRIVATE_KEY)
    };

    server = https.createServer(options, app);

    server.listen(PORT_HTTPS, () => {
        console.log(`Server is running on https://localhost:${PORT_HTTPS}`);
    });
} else {
    // HTTP configuration
    server = app.listen(PORT_HTTP, () => {
        console.log(`Server is running on http://localhost:${PORT_HTTP}`);
    });
}