// https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action
const core = require('@actions/core');
const { Client } = require('crosis4furrets');

const GraphQL = ({ query, variables, token }) =>
  new Promise((res, rej) => {
    fetch("https://replit.com/graphql", {
      method: "POST",
      headers: {
        "X-Requested-With": "GitHub Action (DaInfLoop/Replit-Deployments)",
        "Referer": "https://replit.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
        ...(token ? { "Cookie": `connect.sid=${token};` } : {})
      },
      body: JSON.stringify({
        query,
        variables
      }).then(r => r.json()).then(({ data, errors = [] }) => {
        if (errors.length && !data) return rej(new Error("There was an error with fetching from Replit's servers. Perhaps your token or repl ID is invalid?"))

        return res(data)
      })
    })
  })

(async () => {
  let crosis;
  try {
    const replId = core.getInput('replId');
    const token = encodeURIComponent(decodeURIComponent(core.getInput('token')));

    if (!replId) throw new Error("You didn't specify a repl ID. Get it by running `echo $REPL_ID` in your Repl's shell.")

    if (!token) throw new Error("You didn't specify your connect.sid token. Get it by looking at your cookies.")
  
    const { repl } = await GraphQL({
      query: `query GetCurrentDeployment($replId: String!) {
    repl(id: $replId) {
      __typename
      hostingDeployment {
        __typename
        ...on HostingDeployment {
          id
        }
      }
    }      
  }`,
      variables: {
        replId
      },
      token
    });

    if (repl.hostingDeployment.__typename !== "HostingDeployment") {
      // No deployment has been created, so we choose a plan (Pro / 20 cycles per day)
      const { setHostingTier } = await GraphQL({
        query: `mutation SetHostingTier($input: SetHostingTierInput!) {
  setHostingTier(input: $input) {
    __typename
    ...on UserError {
      message
      __typename
    }
    ...on PaymentError {
      message
      __typename
    }
    ...on SetHostingTierResult {
      repl {
        ... on Repl {
          ...HostingTierReplPowerUps
          ...HostingTierPowerUpCosts
          __typename
        }
        __typename
      }
    }
  }
}`,
        variables: {
          input: {
            replId,
            sku: "hosting_tier_e2_micro"
          }
        },
        token
      })
      if (setHostingTier.__typename !== "SetHostingTierResult") throw new Error("Could not subscribe to the Pro deployment plan. Please manually set a deployment tier in the Replit IDE and run this workflow again.")
    }

    crosis = new Client({
      replId,
      token
    })

    await crosis.connect();
    await crosis.persist();
    await crosis.shellExec("git pull", 10_000)
    await crosis.close();

    await GraphQL({
      query: `mutation DeployRepl($input: DeployHostingBuild2Input!) {
  deployHostingBuild2(input: $input) {
    ...on DeployHostingBuild2Result {
      __typename
      targetDeployment {
        replitAppSubdomain
      }
    }
  }
}`,
      variables: {
        input: {
          replId,
          targetDeploymentId: repl.hostingDeployment?.id,
          subdomain: core.getInput('subdomain'),
          commands: {
            build: core.getInput('buildCommand'),
            run: core.getInput('runCommand')
          }
        }
      },
      token
    })
  } catch (error) {
    if (crosis) await crosis.close();
    core.setFailed(error.message);
  }
})();