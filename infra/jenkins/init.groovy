import com.cloudbees.plugins.credentials.*
import com.cloudbees.plugins.credentials.domains.*
import com.cloudbees.plugins.credentials.impl.*
import com.cloudbees.plugins.credentials.CredentialsProvider
import hudson.plugins.git.*
import jenkins.model.Jenkins
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition
import hudson.security.*

def jenkins = Jenkins.instance

def hudsonRealm = new HudsonPrivateSecurityRealm(false)
hudsonRealm.createAccount("admin", "admin")
jenkins.setSecurityRealm(hudsonRealm)

def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
jenkins.setAuthorizationStrategy(strategy)

jenkins.save()

println("Created Jenkins admin user")

// ---------- DockerHub credential ----------
def dockerUser = new File("/tmp/dockerhub-user").text.trim()
def dockerToken = new File("/tmp/dockerhub-token").text.trim()
def credentialsId = "dockerhub-creds"

def store = jenkins
  .getExtensionList("com.cloudbees.plugins.credentials.SystemCredentialsProvider")[0]
  .getStore()

def existingCred = CredentialsProvider.lookupCredentials(
  Credentials.class,
  jenkins,
  null,
  null
).find { it.id == credentialsId }

if (existingCred == null) {
  def credential = new UsernamePasswordCredentialsImpl(
    CredentialsScope.GLOBAL,
    credentialsId,
    "DockerHub credentials for rate limiter pipeline",
    dockerUser,
    dockerToken
  )

  store.addCredentials(Domain.global(), credential)
  println("Created DockerHub credential: ${credentialsId}")
} else {
  println("DockerHub credential already exists: ${credentialsId}")
}

// ---------- Pipeline job ----------
def jobName = "rate-limiter-pipeline"
def repoUrl = "https://github.com/aabhaasgupt/rate_limiter.git"
def branch = "*/main"
def jenkinsfilePath = "Jenkinsfile"

def existingJob = jenkins.getItem(jobName)

if (existingJob == null) {
  def job = jenkins.createProject(WorkflowJob, jobName)

  def scm = new GitSCM(
    [new UserRemoteConfig(repoUrl, null, null, null)],
    [new BranchSpec(branch)],
    false,
    [],
    null,
    null,
    []
  )

  def definition = new CpsScmFlowDefinition(scm, jenkinsfilePath)
  definition.setLightweight(true)

  job.setDefinition(definition)
  job.save()

  println("Created Jenkins pipeline job: ${jobName}")
} else {
  println("Jenkins pipeline job already exists: ${jobName}")
}

jenkins.save()
println("Jenkins init.groovy completed")