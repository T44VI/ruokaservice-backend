import {
  APIGatewayTokenAuthorizerHandler,
  APIGatewayAuthorizerResult,
  APIGatewayAuthorizerResultContext,
} from "aws-lambda";
// A simple token-based authorizer example to demonstrate how to use an authorization token
// to allow or deny a request. In this example, the caller named 'user' is allowed to invoke
// a request if the client-supplied token value is 'allow'. The caller is not allowed to invoke
// the request if the token value is 'deny'. If the token value is 'unauthorized' or an empty
// string, the authorizer function returns an HTTP 401 status code. For any other token value,
// the authorizer returns an HTTP 500 status code.
// Note that token values are case-sensitive.

export const allowAll: APIGatewayTokenAuthorizerHandler = (
  event,
  context,
  callback
) => {
  var token = event.authorizationToken;
  switch (token) {
    case process.env.ADMINPASSWORD:
      callback(
        null,
        generatePolicy("user", "Allow", event.methodArn, { role: "admin" })
      );
      break;
    case process.env.USERPASSWORD:
      callback(
        null,
        generatePolicy("user", "Allow", event.methodArn, { role: "user" })
      );
      break;
    default:
      callback("Error: Invalid token"); // Return a 500 Invalid token response
  }
};

export const allowAdmin: APIGatewayTokenAuthorizerHandler = (
  event,
  context,
  callback
) => {
  var token = event.authorizationToken;
  switch (token) {
    case process.env.ADMINPASSWORD:
      callback(
        null,
        generatePolicy("user", "Allow", event.methodArn, { role: "admin" })
      );
      break;
    default:
      callback("Unauthorized"); // Return a 401 Unauthorized response
  }
};

// Help function to generate an IAM policy
const generatePolicy = (
  principalId: string,
  effect: string,
  resource: string | string[],
  context?: APIGatewayAuthorizerResultContext
): APIGatewayAuthorizerResult => {
  const authResponse: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [],
    },
    context,
  };
  if (effect && resource) {
    authResponse.policyDocument.Statement.push({
      Action: "execute-api:Invoke",
      Resource: resource,
      Effect: effect,
    });
  }

  // Optional output with custom properties of the String, Number or Boolean type.
  return authResponse;
};
