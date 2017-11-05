const AWS = require('aws-sdk')
const validator = require('validator')
const uuidv4 = require('uuid/v4')
const nodemailer = require('nodemailer')
const smtpTransport = require('nodemailer-smtp-transport')

const docClient = new AWS.DynamoDB.DocumentClient()
const sns = new AWS.SNS()
const sqs = new AWS.SQS()

exports.listGigs = (event, context, callback) => {
  const queryParams = {
    TableName: 'gig'
  }

  docClient.scan(queryParams, (err, data) => {
    if (err) {
      console.error(err)

      return callback(null, {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({error: 'Internal Server Error'})
      })
    }

    const response = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({gigs: data.Items})
    }

    return callback(null, response)
  })
}

exports.gig = (event, context, callback) => {
  const gigSlug = event.pathParameters.slug

  const queryParams = {
    Key: {
      slug: gigSlug
    },
    TableName: 'gig'
  }

  docClient.get(queryParams, (err, data) => {
    if (err) {
      console.error(err)
      return callback(null, {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({error: 'Internal Server Error'})
      })
    }

    // item not found, return 404
    if (!data.Item) {
      return callback(null, {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({error: 'Gig not found'})
      })
    }

    const response = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data.Item)
    }

    return callback(null, response)
  })
}

exports.purchaseTicket = (event, context, callback) => {
  // receives a JSON in the event.body containing:
  //   - gig: needs to be an existing gig
  //   - name: non empty string
  //   - email: valid email
  //   - cardNumber: valid credit card number
  //   - cardExpiryMonth: required (int between 1 and 12)
  //   - cardExpiryYear: required (int between 2018 and 2024) (month and year in the future)
  //   - cardCVC: required (valid cvc)
  //   - disclaimerAccepted: required (true)
  //
  //   Must return a validation error (400 Bad request) with the following object:
  //   {error: "Invalid request", errors: [{field: "fieldName", message: "error message"}]}
  //
  //   or, in case of success a 202 (Accepted) with body { success: true }

  let data

  // parses the input
  try {
    data = JSON.parse(event.body)
  } catch (err) {
    return callback(null, {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({error: 'Invalid content, expected valid JSON'})
    })
  }

  // validates every field
  const errors = []

  // gig: needs to be an existing gig
  if (!data.gig) {
    errors.push({field: 'gig', message: 'field is mandatory'})
    // validating if the gig exists in DynamoDB is left as an exercise
  }

  // name: non empty string
  if (!data.name) {
    errors.push({field: 'name', message: 'field is mandatory'})
  }

  // email: valid email
  if (!data.email) {
    errors.push({field: 'email', message: 'field is mandatory'})
  } else if (!validator.isEmail(data.email)) {
    errors.push({field: 'email', message: 'field is not a valid email'})
  }

  // cardNumber: valid credit card number
  if (!data.cardNumber) {
    errors.push({field: 'cardNumber', message: 'field is mandatory'})
  } else if (!validator.isCreditCard(data.cardNumber)) {
    errors.push({field: 'cardNumber', message: 'field is not a valid credit card number'})
  }

  // cardExpiryMonth: required (int between 1 and 12)
  if (!data.cardExpiryMonth) {
    errors.push({field: 'cardExpiryMonth', message: 'field is mandatory'})
  } else if (!validator.isInt(String(data.cardExpiryMonth), {min: 1, max: 12})) {
    errors.push({field: 'cardExpiryMonth', message: 'field must be an integer in range [1,12]'})
  }

  // cardExpiryYear: required (month and year in the future)
  if (!data.cardExpiryYear) {
    errors.push({field: 'cardExpiryYear', message: 'field is mandatory'})
  } else if (!validator.isInt(String(data.cardExpiryYear), {min: 2018, max: 2024})) {
    errors.push({field: 'cardExpiryYear', message: 'field must be an integer in range [2018,2024]'})
  }

  // validating that expiry is in the future is left as exercise
  // (consider using a library like moment.js)

  // cardCVC: required (valid cvc)
  if (!data.cardCVC) {
    errors.push({field: 'cardCVC', message: 'field is mandatory'})
  } else if (!String(data.cardCVC).match(/^[0-9]{3,4}$/)) {
    errors.push({field: 'cardCVC', message: 'field must be a valid CVC'})
  }

  // disclaimerAccepted: required (true)
  if (data.disclaimerAccepted !== true) {
    errors.push({field: 'disclaimerAccepted', message: 'field must be true'})
  }

  // if there are errors, return a 400 with the list of errors

  if (errors.length) {
    return callback(null, {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({error: 'Invalid Request', errors})
    })
  }

  // fetch gig from DynamoDB
  const queryParams = {
    Key: {
      slug: data.gig
    },
    TableName: 'gig'
  }

  docClient.get(queryParams, (err, dynamoData) => {
    if (err) {
      console.error(err)
      return callback(null, {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({error: 'Internal Server Error'})
      })
    }

    // item not found, return 404
    if (!dynamoData.Item) {
      return callback(null, {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({error: 'Invalid gig'})
      })
    }

    const gig = dynamoData.Item
    // creates a ticket object
    const ticket = {
      id: uuidv4(),
      createdAt: Date.now(),
      name: data.name,
      email: data.email,
      gig: data.gig
    }

    // fires an sns message with gig and ticket
    sns.publish({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Message: JSON.stringify({ticket, gig})
    }, (err, data) => {
      if (err) {
        console.error(err)
        return callback(null, {
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({error: 'Internal Server Error'})
        })
      }

      // if everything went well return a 202 (accepted)
      return callback(null, {
        statusCode: 202,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({success: true})
      })
    })
  })
}

exports.cors = (event, context, callback) => {
  callback(null, {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'
    },
    body: ''
  })
}

exports.sendMailWorker = (event, context, callback) => {
  const receiveMessageParams = {
    QueueUrl: process.env.SQS_QUEUE_URL,
    MaxNumberOfMessages: 1
  }

  sqs.receiveMessage(receiveMessageParams, (err, data) => {
    if (err) {
      console.error(err)
      return callback(err)
    }

    if (!data.Messages) {
      console.log('no messages to process')
      return callback(null, 'no messages to process')
    }

    const message = data.Messages[0]

    // extract message data from sqs message
    // the double JSON parse is because the sqs message contains the original sns message
    // in the body, so we are basically extracting the data from the `Message` attribute
    // of the original sns message.
    const messageData = JSON.parse(JSON.parse(message.Body).Message)

    const transporter = nodemailer.createTransport(smtpTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD
      }
    }))

    const subject = `Your ticket for ${messageData.gig.bandName} in ${messageData.gig.city}`

    const content = `
Hey ${messageData.ticket.name},
you are going to see ${messageData.gig.bandName} in ${messageData.gig.city}!

This is the secret code that will give you access to our time travel collection point:

---
${messageData.ticket.id}
---

Be sure to show it to our staff at entrance.

Collection point is placed in ${messageData.gig.collectionPoint}.
Be sure to be there on ${messageData.gig.date} at ${messageData.gig.collectionTime}

We already look forward (or maybe backward) to having you there, it's going to be epic!

— Your friendly Ticketless staff

PS: remember that is forbidden to place bets or do any other action that might substantially
increase your net worth while time travelling. Travel safe!
`

    const mailOptions = {
      from: process.env.SMTP_SENDER_ADDRESS,
      to: messageData.ticket.email,
      subject,
      text: content
    }

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error(err)
        return callback(err)
      }

      // delete message from queue
      const deleteMessageParams = {
        QueueUrl: process.env.SQS_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle
      }

      sqs.deleteMessage(deleteMessageParams, (err, data) => {
        if (err) {
          console.error(err)
          return callback(err)
        }

        console.log('1 message processed successfully')
        return callback(null, 'Completed')
      })
    })
  })
}
