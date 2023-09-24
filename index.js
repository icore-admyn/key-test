const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const { decodeSubjectChain, calculateNet, calculateGross } = require('relay-jwt');
const jwa = require('jwa');
const { default: axios } = require('axios');

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

const feeShifting = async (amount, url, key) => {
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
        const badgerVarFee = 0.05;
        const amountWithoutBadgerFees = (amount - badgerFixedFee) / (1 + badgerVarFee);
        const amountWithBadgerFees = ((1 + badgerVarFee) * amount) + badgerFixedFee;
        const netAmountForDollar = +calculateNet(amountWithoutBadgerFees, decodedChain, buxDecimals).toFixed(4);
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
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
