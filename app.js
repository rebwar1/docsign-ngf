const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");

dotenv.config();

const app = express();
const PORT = 3001;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "dfsf94835asdauysf65",
    resave: true,
    saveUninitialized: true,
  })
);

async function checkToken(request) {
  if (request.session.access_token && Date.now() < request.session.expires_at) {
    // console.log("re-using access_token ", request.session.access_token);
  } else {
    // console.log("generating a new access token");
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    const results = await dsApiClient.requestJWTUserToken(
      process.env.INTEGRATION_KEY,
      process.env.USER_ID,
      "signature",
      fs.readFileSync(path.join(__dirname, "private.key")),
      3600
    );

    request.session.access_token = results.body.access_token;
    request.session.expires_at =
      Date.now() + (results.body.expires_in - 60) * 1000;
  }
}

app.post("/form", async (request, response) => {
  await checkToken(request);
  let envelopesApi = getEnvelopesApi(request);
  let envelope = makeEnvelope(
    request.body.name,
    request.body.email,
    request.body.company
  );

  let results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, {
    envelopeDefinition: envelope,
  });
  // console.log("envelope results ", results);
  // Create the recipient view, the Signing Ceremony
  let viewRequest = makeRecipientViewRequest(
    request.body.name,
    request.body.email
  );
  results = await envelopesApi.createRecipientView(
    process.env.ACCOUNT_ID,
    results.envelopeId,
    {
      recipientViewRequest: viewRequest,
    }
  );

  response.redirect(results.url);
});

function getEnvelopesApi(request) {
  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + request.session.access_token
  );
  return new docusign.EnvelopesApi(dsApiClient);
}

function makeEnvelope(name, email, company) {
  let env = new docusign.EnvelopeDefinition();
  env.templateId = process.env.TEMPLATE_ID;
  let text = new docusign.Text.constructFromObject({
    tabLabel: "company_name",
    value: company,
  });

  // Pull together the existing and new tabs in a Tabs object:
  let tabs = new docusign.Tabs.constructFromObject({
    textTabs: [text],
  });

  let signer1 = new docusign.TemplateRole.constructFromObject({
    email: email,
    name: name,
    tabs: tabs,
    clientUserId: process.env.CLIENT_USER_ID,
    roleName: "Applicant",
  });

  env.templateRoles = [signer1];
  env.status = "sent";

  return env;
}

function makeRecipientViewRequest(name, email) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = "http://localhost:3001/success";
  viewRequest.authenticationMethod = "none";

  // Recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = process.env.CLIENT_USER_ID;

  return viewRequest;
}

app.get("/", async (request, response) => {
  await checkToken(request);
  response.render("main");
});

app.get("/success", (request, response) => {
  response.render("redirect");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
