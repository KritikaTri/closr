import { SocialLogin } from "@capgo/capacitor-social-login";

window.CLOSER_NATIVE_AUTH = {
  async googleIdToken(config) {
    await SocialLogin.initialize({ google: {
      webClientId: config.webClientId,
      iOSClientId: config.iOSClientId,
      iOSServerClientId: config.webClientId,
      mode: "online",
    } });
    const result = await SocialLogin.login({
      provider: "google",
      options: { scopes: ["email", "profile"] },
    });
    return {
      idToken: result.result?.idToken,
      accessToken: result.result?.accessToken?.token,
    };
  },
  async appleIdToken(config) {
    await SocialLogin.initialize({ apple: {
      clientId: config.serviceId,
      redirectUrl: config.redirectUrl,
    } });
    const result = await SocialLogin.login({
      provider: "apple",
      options: { scopes: ["email", "name"] },
    });
    return {
      idToken: result.result?.idToken,
      accessToken: result.result?.accessToken?.token,
    };
  },
};
