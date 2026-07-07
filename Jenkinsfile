pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'aabhaasgupt/rate-limiter-api'
        IMAGE_TAG = "v${BUILD_NUMBER}"
    }

    stages {
        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build \
                      --platform linux/amd64 \
                      -t ${DOCKER_IMAGE}:${IMAGE_TAG} \
                      ./app
                '''
            }
        }

        stage('Push Docker Image') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKERHUB_USERNAME',
                    passwordVariable: 'DOCKERHUB_PASSWORD'
                )]) {
                    sh '''
                        echo "$DOCKERHUB_PASSWORD" | docker login \
                          -u "$DOCKERHUB_USERNAME" \
                          --password-stdin

                        docker push ${DOCKER_IMAGE}:${IMAGE_TAG}
                    '''
                }
            }
        }
        
        stage('Patch Kubernetes Provider IDs') {
            steps {
                sh '''
                    chmod +x scripts/k8s-bootstrap/patch-provider-ids.sh
                    KUBECONFIG_PATH=/var/lib/jenkins/.kube/config \
                    scripts/k8s-bootstrap/patch-provider-ids.sh
                '''
            }
        }

        stage('Apply Kubernetes Manifests') {
            steps {
                sh '''
                    kubectl apply -f k8s/aws/
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    kubectl set image deployment/rate-limiter-api \
                      rate-limiter-api=${DOCKER_IMAGE}:${IMAGE_TAG}

                    kubectl rollout status deployment/rate-limiter-api
                '''
            }
        }
    }
}