pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'aabhaasgupt/rate-limiter-api'
        IMAGE_TAG = "v${BUILD_NUMBER}"
        KUBECONFIG = '/var/lib/jenkins/.kube/config'
    }

    stages {
        stage('Verify Prerequisites') {
            steps {
                sh '''
                    docker version
                    kubectl get nodes
                '''
            }
        }

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

        stage('Apply Kubernetes Manifests') {
            steps {
                sh '''
                    kubectl apply -f k8s/aws/
                '''
            }
        }

        stage('Deploy New Image') {
            steps {
                sh '''
                    kubectl set image deployment/rate-limiter-api \
                      rate-limiter-api=${DOCKER_IMAGE}:${IMAGE_TAG}

                    kubectl rollout status \
                      deployment/rate-limiter-api \
                      --timeout=300s
                '''
            }
        }

        stage('Verify Kubernetes Resources') {
            steps {
                sh '''
                    kubectl get pods -o wide
                    kubectl get service rate-limiter-api-service
                    kubectl get ingress rate-limiter-api-ingress
                '''
            }
        }

        stage('Wait for ALB') {
            steps {
                sh '''
                    echo "Waiting for ALB hostname..."

                    for i in $(seq 1 40); do
                      ALB_HOSTNAME=$(kubectl get ingress rate-limiter-api-ingress \
                        -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' \
                        2>/dev/null || true)

                      if [ -n "$ALB_HOSTNAME" ]; then
                        echo "ALB hostname: $ALB_HOSTNAME"
                        exit 0
                      fi

                      echo "ALB not ready yet. Retrying in 15 seconds..."
                      sleep 15
                    done

                    echo "Timed out waiting for ALB hostname"
                    kubectl describe ingress rate-limiter-api-ingress
                    exit 1
                '''
            }
        }
    }

    post {
        always {
            sh 'docker logout || true'
        }
    }
}