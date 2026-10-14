package ai.taskpilot.coreapi.access

/** Access-owned identity operation used by the onboarding transaction coordinator. */
fun interface AccessAccountProvisioning {
    fun provisionAccount(request: FederatedAccountProvisioningRequest)
}
