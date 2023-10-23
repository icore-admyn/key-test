const { decodeSubjectChain, calculateNet } = require('relay-jwt');
const jwt = require('jsonwebtoken');
const jwa = require('jwa');

/* Define the algorithm for signing and verifying JWT tokens */
const algorithm = 'ES256';
const ecdsa = jwa(algorithm);

/* Input variables */
const amount = 100; // Total amount ($) user pays
const key = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE...' // Bearer auth token

/* Decode the JWT token subject chain */
const decoded = jwt.decode(key);
const decodedChain = decodeSubjectChain(decoded.sub, ecdsa.verify);

/*  Define some constants */
const buxDecimals = 4;
const badgerVarFee = 0.0504; // Wert Fee

/*  Find amounts */
const amountWithoutBadgerFees = amount / (1 + badgerVarFee); // Calculate the amount without Badger fees
const netAmountForDollar = +calculateNet(amountWithoutBadgerFees, decodedChain, buxDecimals).toFixed(4); // Calculate the net amount for a dollar

console.log(netAmountForDollar);
